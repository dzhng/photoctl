import {
  acquireLibraryLock,
  initializeLibrary,
  OPEN_LOCK_NAME,
  type LibraryLock,
} from "@photoctl/library";
import { requestDaemon, IDLE_CEILING_MS } from "@photoctl/commands";
import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, Server, Socket } from "node:net";
import { once } from "node:events";
import { encodeFrame, FrameDecoder } from "@photoctl/protocol";
import { DaemonServer, KEEPALIVE_INTERVAL_MS } from "./server.js";

const SILENT_HANDLER_MS = IDLE_CEILING_MS + 2 * KEEPALIVE_INTERVAL_MS;
let waitForHandler = () => new Promise<void>((resolve) => setTimeout(resolve, SILENT_HANDLER_MS));

vi.mock("@photoctl/commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@photoctl/commands")>();
  return {
    ...actual,
    // A handler that does real work without emitting a single progress frame,
    // like a paid generation waiting on a slow provider.
    dispatch: async () => {
      await waitForHandler();
      return { schema: 1, ok: true, data: { silent: true }, warnings: [] };
    },
  };
});

let directory: string | undefined;
let server: DaemonServer | undefined;
let lock: LibraryLock | undefined;
afterEach(async () => {
  await server?.stop();
  // The server adopted and closed the descriptor; only drop the in-process registration.
  await lock?.detach().catch(() => undefined);
  if (directory) await rm(directory, { recursive: true, force: true });
  server = undefined;
  lock = undefined;
  directory = undefined;
  vi.restoreAllMocks();
});

async function startServer(): Promise<string> {
  directory = await mkdtemp(join(tmpdir(), "photoctl-daemon-keepalive-"));
  const library = join(directory, "library");
  const initialized = await initializeLibrary(library);
  await initialized.handle.close();
  lock = await acquireLibraryLock(join(library, OPEN_LOCK_NAME), 0);
  const socketPath = join(directory, "daemon.sock");
  server = new DaemonServer({
    libraryPath: library,
    socketPath,
    version: "0.0.0-test",
    lockFd: lock.fd,
    lockStartedAt: Date.now(),
  });
  await server.start();
  return socketPath;
}

test("a handler that emits nothing for longer than the client's idle ceiling still returns its envelope", async () => {
  const socketPath = await startServer();
  const startedAt = Date.now();
  const result = await requestDaemon(socketPath, {
    verb: "doctor",
    args: [],
    cwd: "/",
    env: { noDaemon: false, lockBudgetMs: "0" },
  });

  expect(result.envelope).toMatchObject({ ok: true, data: { silent: true } });
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(SILENT_HANDLER_MS);
}, 60_000);

test.each([1, 2])(
  "disconnecting with %i request frames stops writes to the closed connection",
  async (requestCount) => {
    const socketPath = await startServer();
    let serverSocket: Socket | undefined;
    const emit = Server.prototype.emit;
    vi.spyOn(Server.prototype, "emit").mockImplementation(function (
      this: Server,
      event: string | symbol,
      ...args: unknown[]
    ) {
      if (event === "connection" && args[0] instanceof Socket) serverSocket = args[0];
      return Reflect.apply(emit, this, [event, ...args]);
    });
    let releaseHandler!: () => void;
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    waitForHandler = () => handlerGate;
    const client = connect(socketPath);
    try {
      await once(client, "connect");
      const frame = encodeFrame({
        type: "request",
        request: {
          verb: "doctor",
          args: [],
          cwd: "/",
          env: { noDaemon: false, lockBudgetMs: "0" },
        },
      });
      client.write(Buffer.concat(Array.from({ length: requestCount }, () => frame)));
      const decoder = new FrameDecoder();
      let frames: unknown[] = [];
      while (frames.length === 0) {
        // eslint-disable-next-line no-await-in-loop -- A frame may span sequential socket chunks.
        const [chunk] = await once(client, "data");
        frames = decoder.push(chunk);
      }
      expect(frames[0]).toEqual({ type: "keepalive" });
      client.destroy();
      await once(client, "close");
      await vi.waitFor(() => expect(serverSocket?.destroyed).toBe(true));
      const writes = vi.spyOn(serverSocket!, "write");
      await new Promise((resolve) => setTimeout(resolve, 3 * KEEPALIVE_INTERVAL_MS));
      expect(writes).not.toHaveBeenCalled();
    } finally {
      client.destroy();
      releaseHandler();
      await new Promise((resolve) => setImmediate(resolve));
      waitForHandler = () => new Promise<void>((resolve) => setTimeout(resolve, SILENT_HANDLER_MS));
    }
  },
  60_000,
);
