import { dispatch } from "@photoctl/commands";
import {
  adoptLibraryLock,
  createBackup,
  OPEN_LOCK_NAME,
  openLibraryHoldingLock,
  type LibraryHandle,
} from "@photoctl/library";
import {
  FrameDecoder,
  encodeFrame,
  type CommandRequest,
  type DaemonClientFrame,
  type DaemonServerFrame,
  type Envelope,
} from "@photoctl/protocol";
import { PreviewCoordinator } from "@photoctl/render";
import { watch, type FSWatcher } from "node:fs";
import { access, chmod, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { BackgroundRegistry } from "./workers/index.js";

interface QueuedRequest {
  request: CommandRequest;
  socket: Socket;
  enqueuedAt: number | null;
}

export interface DaemonServerOptions {
  libraryPath: string;
  socketPath: string;
  version: string;
  lockFd: number;
  lockStartedAt: number;
}

export class DaemonServer {
  private readonly libraryPath: string;
  private readonly socketPath: string;
  private readonly version: string;
  private readonly lockStartedAt: number;
  private readonly startedAt = Date.now();
  private readonly background = new BackgroundRegistry();
  private readonly pending: QueuedRequest[] = [];
  private readonly lock;
  private server: Server | undefined;
  private library: LibraryHandle | undefined;
  private previewCoordinator: PreviewCoordinator | undefined;
  private watcher: FSWatcher | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;
  private automaticBackup: Promise<void> | undefined;
  private idleMs = 900_000;
  private queueMax = 8;
  private running = false;
  private stopping = false;

  constructor(options: DaemonServerOptions) {
    this.libraryPath = resolve(options.libraryPath);
    this.socketPath = options.socketPath;
    this.version = options.version;
    this.lockStartedAt = options.lockStartedAt;
    this.lock = adoptLibraryLock(join(this.libraryPath, OPEN_LOCK_NAME), options.lockFd);
  }

  registerBackground(name: string, isBusy: () => boolean): () => void {
    return this.background.register(name, isBusy);
  }

  async start(): Promise<void> {
    await this.lock.rewrite({
      pid: process.pid,
      socket: this.socketPath,
      startedAt: this.lockStartedAt,
    });
    this.library = await openLibraryHoldingLock(this.libraryPath, this.lock);
    this.previewCoordinator = new PreviewCoordinator();
    const settings = await this.library.query<{ key: string; value: number }>(
      "SELECT key, value::text::integer AS value FROM settings WHERE key IN ('daemon_idle_ms', 'daemon_queue_max')",
    );
    for (const setting of settings.rows) {
      if (setting.key === "daemon_idle_ms") this.idleMs = setting.value;
      if (setting.key === "daemon_queue_max") this.queueMax = setting.value;
    }
    try {
      await unlink(this.socketPath);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    this.server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolveListen, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.socketPath, resolveListen);
    });
    await chmod(this.socketPath, 0o600);
    this.watchLibrary();
    this.startAutomaticBackup();
    this.armIdleTimer();
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.watcher?.close();
    await new Promise<void>((resolveClose) => {
      if (!this.server) return resolveClose();
      this.server.close(() => resolveClose());
    });
    if (this.running || this.pending.length > 0) return;
    await this.automaticBackup;
    await this.finishStop();
  }

  private accept(socket: Socket): void {
    const decoder = new FrameDecoder();
    socket.on("data", (chunk) => {
      try {
        for (const value of decoder.push(chunk)) this.route(socket, value as DaemonClientFrame);
      } catch {
        socket.destroy();
      }
    });
  }

  private route(socket: Socket, frame: DaemonClientFrame): void {
    if (frame.type === "control") {
      this.respond(socket, success(this.status()));
      if (frame.action === "stop") setImmediate(() => void this.stop());
      return;
    }
    if (this.stopping || this.pending.length + Number(this.running) >= this.queueMax) {
      this.respond(socket, lockedEnvelope(frame.request, 0));
      return;
    }
    this.pending.push({
      request: frame.request,
      socket,
      enqueuedAt: this.running ? Date.now() : null,
    });
    this.armIdleTimer();
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.running || this.drainTimer) return;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = undefined;
      const admittedAt = Date.now();
      for (const item of this.pending.slice(1)) item.enqueuedAt ??= admittedAt;
      void this.drain();
    }, 5);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    const item = this.pending.shift();
    if (!item) {
      if (this.stopping) await this.finishStop();
      return;
    }
    this.running = true;
    try {
      await this.automaticBackup;
      const budget = parseBudget(item.request.env.lockBudgetMs);
      const waited = item.enqueuedAt === null ? 0 : Date.now() - item.enqueuedAt;
      if (waited > budget) {
        this.respond(item.socket, lockedEnvelope(item.request, waited));
      } else {
        item.request.env.libraryPath = this.libraryPath;
        this.respond(
          item.socket,
          await dispatch(item.request, {
            version: this.version,
            library: this.library,
            previewCoordinator: this.previewCoordinator,
            emit: (event) =>
              item.socket.write(encodeFrame({ type: "event", event } satisfies DaemonServerFrame)),
          }),
        );
      }
    } finally {
      this.running = false;
      this.armIdleTimer();
      void this.drain();
    }
  }

  private status() {
    return {
      pid: process.pid,
      socket: this.socketPath,
      uptime_s: (Date.now() - this.startedAt) / 1000,
      queue: this.pending.length + Number(this.running),
      version: this.version,
    };
  }

  private startAutomaticBackup(): void {
    const library = this.library;
    if (!library) throw new Error("Cannot back up a daemon before its library is open");
    const task = createBackup(library, { automatic: true })
      .then((backup) => {
        if (backup.exceedsMaxBytes) {
          console.error(
            `Automatic backup ${backup.path} exceeds the 200 MiB retention budget; keeping the newest backup`,
          );
        }
      })
      .catch((error: unknown) => {
        console.error(
          `Automatic backup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        if (this.automaticBackup === task) this.automaticBackup = undefined;
      });
    this.automaticBackup = task;
    this.registerBackground("automatic-backup", () => this.automaticBackup !== undefined);
  }

  private respond(socket: Socket, envelope: Envelope): void {
    const frame: DaemonServerFrame = { type: "response", envelope };
    socket.end(encodeFrame(frame));
  }

  private watchLibrary(): void {
    this.watcher = watch(dirname(this.libraryPath), (_event, filename) => {
      if (filename !== basename(this.libraryPath)) return;
      void access(this.libraryPath).catch(() => this.stop());
    });
    this.watcher.on("error", () => void this.stop());
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.running || this.pending.length > 0 || this.background.isBusy()) {
        this.armIdleTimer();
      } else {
        void this.stop();
      }
    }, this.idleMs);
    this.idleTimer.unref();
  }

  private async finishStop(): Promise<void> {
    const library = this.library;
    this.library = undefined;
    await library?.close();
    try {
      await unlink(this.socketPath);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
}

function success(data: unknown): Envelope {
  return { schema: 1, ok: true, data, warnings: [] };
}

function lockedEnvelope(request: CommandRequest, waitedMs: number): Envelope {
  return {
    schema: 1,
    ok: false,
    code: "library_locked",
    data: {
      holder_pid: process.pid,
      waited_ms: Math.min(waitedMs, parseBudget(request.env.lockBudgetMs)),
    },
  };
}

function parseBudget(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 30_000;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
