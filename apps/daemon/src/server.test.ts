import {
  acquireLibraryLock,
  initializeLibrary,
  OPEN_LOCK_NAME,
  type LibraryLock,
} from "@photoctl/library";
import { requestDaemon } from "@photoctl/commands";
import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "./server.js";

const SILENT_HANDLER_MS = 2_500;

vi.mock("@photoctl/commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@photoctl/commands")>();
  return {
    ...actual,
    // A handler that does real work without emitting a single progress frame,
    // like a paid generation waiting on a slow provider.
    dispatch: async () => {
      await new Promise((resolve) => setTimeout(resolve, SILENT_HANDLER_MS));
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
});

test("a handler that emits nothing for longer than the client's idle ceiling still returns its envelope", async () => {
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
