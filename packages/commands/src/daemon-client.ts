import {
  FrameDecoder,
  PhotoctlError,
  encodeFrame,
  type CommandRequest,
  type DaemonClientFrame,
  type DaemonServerFrame,
  type Envelope,
  type StderrEvent,
} from "@photoctl/protocol";
import { acquireLibraryLock, OPEN_LOCK_NAME, readLock, type LockPayload } from "@photoctl/library";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, fchmodSync, openSync } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DaemonEndpoint {
  pid: number;
  socket: string;
  version: string;
}

export interface DaemonStatus extends DaemonEndpoint {
  uptime_s: number;
  queue: number;
}

export interface DaemonConnection {
  endpoint: DaemonEndpoint;
  action: "spawned" | "connected";
}

interface ExchangeResult {
  envelope: Envelope;
  events: StderrEvent[];
}

export function daemonSocketPath(libraryPath: string, version: string): string {
  const hash = createHash("sha1")
    .update(`${resolve(libraryPath)}\0${version}\0schema:1`)
    .digest("hex")
    .slice(0, 8);
  return join(tmpdir(), `photoctl-${hash}.sock`);
}

export async function ensureDaemon(
  libraryPath: string,
  version: string,
  options: { lockBudgetMs?: number; pollCeilingMs?: number; verifyExisting?: boolean } = {},
): Promise<DaemonConnection> {
  const budgetMs = options.lockBudgetMs ?? 30_000;
  const pollCeilingMs = options.pollCeilingMs ?? 100;
  const deadline = Date.now() + budgetMs;
  let lastHolder = 0;
  let attemptedSpawn = false;
  while (true) {
    const payload = await readLock(join(libraryPath, OPEN_LOCK_NAME));
    if (payload) lastHolder = payload.pid;
    const expectedSocket = daemonSocketPath(libraryPath, version);
    const endpoint = options.verifyExisting
      ? null
      : await endpointFromPayload(payload, expectedSocket, version);
    if (endpoint) {
      return {
        endpoint,
        action: "connected",
      };
    }
    const existing = await statusFromPayload(payload);
    if (existing) {
      if (existing.version === version) {
        return { endpoint: daemonEndpoint(existing), action: "connected" };
      }
      await exchange(existing.socket, { type: "control", action: "stop" }, 5_000);
      if (!(await waitForExit(existing.pid, deadline, pollCeilingMs))) {
        throw daemonUnavailable(libraryPath, new Error(`Process ${existing.pid} did not stop`));
      }
      continue;
    }
    try {
      const lock = await acquireLibraryLock(join(libraryPath, OPEN_LOCK_NAME), 0);
      const socket = expectedSocket;
      try {
        await unlink(socket);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) {
          await lock.release();
          throw error;
        }
      }
      const startedAt = Date.now();
      const daemonEntry =
        process.env.PHOTOCTL_DAEMON_ENTRY ??
        fileURLToPath(new URL("../../../apps/daemon/dist/bin.js", import.meta.url));
      const logPath = join(tmpdir(), `${socket.slice(socket.lastIndexOf("/") + 1, -5)}.log`);
      const logFd = openSync(logPath, "w", 0o600);
      fchmodSync(logFd, 0o600);
      let child;
      let spawnError: unknown;
      try {
        child = spawn(
          process.execPath,
          [
            daemonEntry,
            "--library",
            resolve(libraryPath),
            "--socket",
            socket,
            "--version",
            version,
          ],
          {
            detached: true,
            stdio: ["ignore", logFd, logFd, lock.fd],
            env: {
              ...process.env,
              PHOTOCTL_LOCK_FD: "3",
              PHOTOCTL_LOCK_STARTED_AT: String(startedAt),
            },
          },
        );
        child.once("error", (error) => (spawnError = error));
        child.unref();
      } catch (error) {
        closeSync(logFd);
        await lock.release();
        throw daemonUnavailable(libraryPath, error);
      }
      closeSync(logFd);
      attemptedSpawn = true;
      await lock.detach();
      while (Date.now() <= deadline) {
        const status = await statusAt(socket);
        if (status) return { endpoint: daemonEndpoint(status), action: "spawned" };
        if (spawnError) throw daemonUnavailable(libraryPath, spawnError);
        if (child.exitCode !== null) throw daemonUnavailable(libraryPath);
        await delay(Math.min(pollCeilingMs, Math.max(1, deadline - Date.now())));
      }
      throw daemonUnavailable(libraryPath);
    } catch (error) {
      if (!(error instanceof PhotoctlError) || error.code !== "library_locked") throw error;
      if (
        options.verifyExisting &&
        payload?.socket === expectedSocket &&
        processState(payload.pid) !== "dead"
      ) {
        throw daemonUnavailable(libraryPath, new Error(`Process ${payload.pid} did not respond`));
      }
    }

    if (Date.now() >= deadline) {
      if (attemptedSpawn) throw daemonUnavailable(libraryPath);
      throw new PhotoctlError("library_locked", `Library is locked by process ${lastHolder}`, {
        holder_pid: lastHolder,
        waited_ms: budgetMs,
      });
    }
    await delay(Math.min(pollCeilingMs, Math.max(1, deadline - Date.now())));
  }
}

export async function requestDaemon(
  socket: string,
  request: CommandRequest,
): Promise<ExchangeResult> {
  return await exchange(socket, { type: "request", request }, requestTimeout(request));
}

export async function inspectDaemon(libraryPath: string): Promise<DaemonStatus | null> {
  return await statusFromPayload(await readLock(join(resolve(libraryPath), OPEN_LOCK_NAME)));
}

export async function stopDaemon(libraryPath: string): Promise<DaemonStatus | null> {
  const path = resolve(libraryPath);
  const payload = await readLock(join(path, OPEN_LOCK_NAME));
  if (!payload || processState(payload.pid) === "dead") return null;
  if (!payload.socket) {
    throw new PhotoctlError("library_locked", `Library is locked by process ${payload.pid}`, {
      holder_pid: payload.pid,
    });
  }
  const status = await statusAt(payload.socket);
  if (!status) {
    throw new PhotoctlError("daemon_unavailable", "The photoctl daemon is not responding", {
      pid: payload.pid,
      socket: payload.socket,
    });
  }
  await exchange(status.socket, { type: "control", action: "stop" }, 5_000);
  if (!(await waitForExit(status.pid, Date.now() + 5_000, 50))) {
    throw new PhotoctlError("daemon_unavailable", "The photoctl daemon did not stop", {
      pid: status.pid,
      socket: status.socket,
    });
  }
  return status;
}

async function statusFromPayload(payload: LockPayload | null): Promise<DaemonStatus | null> {
  if (!payload?.socket || processState(payload.pid) === "dead") return null;
  return await statusAt(payload.socket);
}

async function endpointFromPayload(
  payload: LockPayload | null,
  expectedSocket: string,
  version: string,
): Promise<DaemonEndpoint | null> {
  if (
    payload?.socket !== expectedSocket ||
    processState(payload.pid) === "dead" ||
    !(await isSocket(expectedSocket))
  ) {
    return null;
  }
  return { pid: payload.pid, socket: expectedSocket, version };
}

async function isSocket(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isSocket();
  } catch {
    return false;
  }
}

async function statusAt(socket: string): Promise<DaemonStatus | null> {
  try {
    const result = await exchange(socket, { type: "control", action: "status" }, 250);
    if (!result.envelope.ok || !("data" in result.envelope)) return null;
    const data = result.envelope.data as Partial<DaemonStatus>;
    return typeof data.pid === "number" && typeof data.version === "string"
      ? (data as DaemonStatus)
      : null;
  } catch {
    return null;
  }
}

async function exchange(
  socketPath: string,
  frame: DaemonClientFrame,
  timeoutMs: number,
): Promise<ExchangeResult> {
  return await new Promise((resolveResult, reject) => {
    const socket = createConnection(socketPath);
    const decoder = new FrameDecoder();
    const events: StderrEvent[] = [];
    let settled = false;
    const timeout = setTimeout(
      () => finish(new Error(`Daemon timed out at ${socketPath}`)),
      timeoutMs,
    );
    const finish = (error?: unknown, result?: ExchangeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (error) reject(error);
      else if (result) resolveResult(result);
    };
    socket.once("connect", () => socket.write(encodeFrame(frame)));
    socket.on("data", (chunk) => {
      try {
        for (const value of decoder.push(chunk)) {
          const response = value as DaemonServerFrame;
          if (response.type === "event") events.push(response.event);
          if (response.type === "response")
            finish(undefined, { envelope: response.envelope, events });
        }
      } catch (error) {
        finish(error);
      }
    });
    socket.once("error", finish);
    socket.once("end", () =>
      finish(new Error(`Daemon closed without a response at ${socketPath}`)),
    );
  });
}

async function waitForExit(pid: number, deadline: number, pollCeilingMs: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if (processState(pid) === "dead") return true;
    await delay(Math.min(pollCeilingMs, Math.max(1, deadline - Date.now())));
  }
  return processState(pid) === "dead";
}

function processState(pid: number): "alive" | "dead" | "unknown" {
  if (!Number.isSafeInteger(pid) || pid <= 0) return "dead";
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    return hasCode(error, "EPERM") ? "unknown" : "dead";
  }
}

function requestTimeout(request: CommandRequest): number {
  const budget = Number(request.env.lockBudgetMs);
  return Number.isSafeInteger(budget) && budget >= 0 ? Math.max(1_000, budget + 1_000) : 31_000;
}

function daemonUnavailable(libraryPath: string, cause?: unknown): PhotoctlError {
  return new PhotoctlError("daemon_unavailable", "Could not start the photoctl daemon", {
    library: resolve(libraryPath),
    ...(cause instanceof Error ? { message: cause.message } : {}),
  });
}

function daemonEndpoint(status: DaemonStatus): DaemonEndpoint {
  return { pid: status.pid, socket: status.socket, version: status.version };
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
