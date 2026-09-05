import type { StderrEvent } from "@photoctl/protocol";

const PROGRESS_INTERVAL_MS = 5_000;

export function createProgressHeartbeat(options: {
  emit?: (event: StderrEvent) => void | Promise<void>;
  phase: string;
  total: number;
  initialDone?: number;
  intervalMs?: number;
}): {
  start(): Promise<void>;
  advance(count: number): Promise<void>;
  stop(): Promise<void>;
} {
  let done = options.initialDone ?? 0;
  let stopped = false;
  let wake: (() => void) | undefined;
  let heartbeat: Promise<void> | undefined;
  let heartbeatError: unknown;
  let heartbeatFailed = false;
  const report = async (): Promise<void> => {
    await options.emit?.({ event: "progress", phase: options.phase, done, total: options.total });
  };
  return {
    async start() {
      await report();
      if (!options.emit) return;
      heartbeat = (async () => {
        try {
          while (true) {
            if (stopped) return;
            await new Promise<void>((resolveSleep) => {
              const timer = setTimeout(
                resolveSleep,
                options.intervalMs ?? PROGRESS_INTERVAL_MS,
              );
              wake = () => {
                clearTimeout(timer);
                resolveSleep();
              };
            });
            wake = undefined;
            if (stopped) return;
            await report();
          }
        } catch (error) {
          heartbeatFailed = true;
          heartbeatError = error;
        }
      })();
    },
    async advance(count) {
      done += count;
      await report();
    },
    async stop() {
      stopped = true;
      wake?.();
      await heartbeat;
      if (heartbeatFailed) throw heartbeatError;
    },
  };
}
