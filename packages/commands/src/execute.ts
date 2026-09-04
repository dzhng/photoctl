import {
  PhotoctlError,
  type CommandRequest,
  type DaemonEvent,
  type Envelope,
  type StderrEvent,
} from "@photoctl/protocol";
import { dispatch, type DispatchContext } from "./dispatch.js";
import {
  ensureDaemon,
  daemonSocketPath,
  inspectDaemon,
  requestDaemon,
  stopDaemon,
  type DaemonEndpoint,
  type DaemonStatus,
} from "./daemon-client.js";
import { libraryPath, parseLockBudget } from "./context.js";

export interface CommandExecution {
  envelope: Envelope;
  events: StderrEvent[];
  stream: unknown[];
}

export async function execute(
  request: CommandRequest,
  context: DispatchContext,
): Promise<CommandExecution> {
  try {
    if (request.verb === "version") {
      return { envelope: await dispatch(request, context), events: [], stream: [] };
    }
    const path = commandLibraryPath(request);
    if (request.verb === "daemon")
      return await executeDaemonControl(request, context.version, path);
    if (request.verb === "restore") {
      await stopDaemon(path);
      return { envelope: await dispatch(request, context), events: [], stream: [] };
    }
    if (request.env.noDaemon) {
      await stopDaemon(path, { ignoreDirectHolder: true });
      const events: StderrEvent[] = [];
      const stream: unknown[] = [];
      return {
        envelope: await dispatch(request, {
          ...context,
          emit: async (event) => {
            if (context.emit) await context.emit(event);
            else events.push(event);
          },
          stream: async (row) => {
            if (context.stream) await context.stream(row);
            else stream.push(row);
          },
        }),
        events,
        stream,
      };
    }
    if (request.verb === "init") {
      const envelope = await dispatch(request, context);
      if (!envelope.ok) return { envelope, events: [], stream: [] };
      try {
        const connection = await ensureDaemon(path, context.version, daemonOptions(request));
        return {
          envelope,
          events: [daemonEvent(connection.action, connection.endpoint)],
          stream: [],
        };
      } catch (error) {
        if (!(error instanceof PhotoctlError) || error.code !== "daemon_unavailable") throw error;
        return {
          envelope: {
            ...envelope,
            warnings: [
              ...envelope.warnings,
              {
                code: "daemon_unavailable",
                message: "The library was initialized, but its daemon could not be started",
              },
            ],
          },
          events: [],
          stream: [],
        };
      }
    }
    let connection = await ensureDaemon(path, context.version, daemonOptions(request));
    let result;
    try {
      result = await requestDaemon(
        connection.endpoint.socket,
        request,
        context.stream,
        context.emit,
      );
    } catch {
      const recovered = await ensureDaemon(path, context.version, {
        ...daemonOptions(request),
        verifyExisting: true,
      });
      connection = recovered;
      try {
        result = await requestDaemon(
          recovered.endpoint.socket,
          request,
          context.stream,
          context.emit,
        );
      } catch (error) {
        throw new PhotoctlError("daemon_unavailable", "The photoctl daemon did not respond", {
          library: path,
          ...(error instanceof Error ? { message: error.message } : {}),
        });
      }
    }
    return {
      envelope: result.envelope,
      events: [daemonEvent(connection.action, connection.endpoint), ...result.events],
      stream: result.stream,
    };
  } catch (error) {
    if (error instanceof PhotoctlError) {
      return {
        envelope: {
          schema: 1,
          ok: false,
          code: error.code,
          data: error.data ?? { message: error.message },
        },
        events: [],
        stream: [],
      };
    }
    throw error;
  }
}

async function executeDaemonControl(
  request: CommandRequest,
  version: string,
  path: string,
): Promise<CommandExecution> {
  if (request.args.length !== 1 || !["start", "stop", "status"].includes(request.args[0])) {
    throw new PhotoctlError("usage", "daemon requires exactly one of start, stop, or status");
  }
  const action = request.args[0];
  if (action === "start") {
    const connection = await ensureDaemon(path, version, daemonOptions(request));
    const status = await inspectDaemon(path);
    if (!status)
      throw new PhotoctlError("daemon_unavailable", "The photoctl daemon is not responding");
    return {
      envelope: success(status),
      events: [daemonEvent(connection.action, status)],
      stream: [],
    };
  }
  if (action === "status") {
    const status = await inspectDaemon(path);
    if (!status)
      throw new PhotoctlError("daemon_unavailable", "The photoctl daemon is not running");
    return { envelope: success(status), events: [daemonEvent("connected", status)], stream: [] };
  }
  const stopped = await stopDaemon(path);
  return {
    envelope: success(stopped ?? stoppedStatus(path, version)),
    events: stopped ? [daemonEvent("stopped", stopped)] : [],
    stream: [],
  };
}

function commandLibraryPath(request: CommandRequest): string {
  if (request.verb !== "init" && request.verb !== "restore") {
    return libraryPath(request.env, request.cwd);
  }
  for (let index = 0; index < request.args.length; index += 1) {
    if (request.args[index] === "--path" && request.args[index + 1]) {
      return libraryPath({ libraryPath: request.args[index + 1] }, request.cwd);
    }
  }
  return libraryPath(request.env, request.cwd);
}

function daemonOptions(request: CommandRequest): {
  lockBudgetMs?: number;
  pollCeilingMs?: number;
} {
  return {
    lockBudgetMs: parseLockBudget(request.env.lockBudgetMs),
    pollCeilingMs: parsePollCeiling(request.env.pollCeilingMs),
  };
}

function parsePollCeiling(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new PhotoctlError("usage", "PHOTOCTL_POLL_CEILING_MS must be a positive integer");
  }
  return milliseconds;
}

function daemonEvent(action: string, status: DaemonEndpoint): DaemonEvent {
  return {
    event: "daemon",
    action,
    pid: status.pid,
    socket: status.socket,
    version: status.version,
    schema: 1,
  };
}

function success(data: unknown): Envelope {
  return { schema: 1, ok: true, data, warnings: [] };
}

function stoppedStatus(path: string, version: string): DaemonStatus {
  return { pid: 0, socket: daemonSocketPath(path, version), uptime_s: 0, queue: 0, version };
}
