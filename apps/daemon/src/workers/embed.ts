import { EMBED_PROVIDER_BATCH_SIZE, embedPhotoBatch } from "@photoctl/commands";
import type { LibraryHandle } from "@photoctl/library";
import type { CommandRequest } from "@photoctl/protocol";

export function deriveEmbedTiming(pollCeilingMs: number): {
  pollCeilingMs: number;
  interBatchYieldMs: number;
} {
  if (!Number.isSafeInteger(pollCeilingMs) || pollCeilingMs < 1) {
    throw new Error("Embedding poll ceiling must be a positive integer");
  }
  return { pollCeilingMs, interBatchYieldMs: pollCeilingMs * 2 };
}

export class EmbedWorker {
  private running: Promise<void> | undefined;
  private stopped = false;
  private paused = false;
  private pendingKick = false;
  private wake: (() => void) | undefined;
  private activeAbort: AbortController | undefined;
  private afterId: string | undefined;
  private retryNotBefore: number | undefined;
  private failedInSweep = false;
  private configurationPaused = false;
  private cooldownSleeping = false;
  private context: { env: CommandRequest["env"]; cwd: string };

  constructor(
    private readonly options: {
      handle: LibraryHandle;
      env: CommandRequest["env"];
      cwd: string;
      foregroundBusy(): boolean;
      pollCeilingMs?: number;
      attemptCooldownMs?: number;
      reportError?: (message: string) => void;
    },
  ) {
    this.context = { env: options.env, cwd: options.cwd };
  }

  updateContext(env: CommandRequest["env"], cwd: string): void {
    this.context = { env, cwd };
    if (this.configurationPaused) {
      this.resetSweep();
      this.configurationPaused = false;
    }
  }

  kick(): void {
    if (this.stopped || this.paused || this.configurationPaused) return;
    this.pendingKick = true;
    if (!this.cooldownSleeping) this.wake?.();
    if (!this.running) {
      this.running = this.run()
        .catch((error: unknown) => {
          // A broken catalog/configuration needs a later foreground kick, not
          // a detached rejection loop that can take down daemon shutdown.
          this.pendingKick = false;
          const detail = error instanceof Error ? error.message : "unknown failure";
          const message = `Embedding worker stopped: ${detail.replaceAll(/\s+/g, " ").slice(0, 256)}`;
          try {
            (this.options.reportError ?? console.error)(message);
          } catch {
            // Reporting is diagnostic; it cannot make the background failure fatal.
          }
        })
        .finally(() => {
          this.running = undefined;
          if (this.pendingKick && !this.stopped) this.kick();
        });
    }
  }

  isBusy(): boolean {
    return this.running !== undefined;
  }

  async pause(): Promise<void> {
    if (this.stopped) return;
    this.paused = true;
    this.pendingKick = false;
    this.activeAbort?.abort();
    this.wake?.();
    await this.running;
  }

  resume(): void {
    if (this.stopped) return;
    this.paused = false;
    this.kick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.activeAbort?.abort();
    this.wake?.();
    await this.running;
  }

  private async run(): Promise<void> {
    const timing = deriveEmbedTiming(this.options.pollCeilingMs ?? 100);
    while (!this.stopped && !this.paused) {
      this.pendingKick = false;
      while (this.options.foregroundBusy() && !this.stopped && !this.paused) {
        await this.sleep(timing.pollCeilingMs);
      }
      if (this.stopped || this.paused) return;
      const mode = await this.options.handle.query<{ value: string }>(
        "SELECT value #>> '{}' AS value FROM settings WHERE key = 'embed_mode'",
      );
      if (this.paused) return;
      const context = this.context;
      if (mode.rows[0]?.value !== "auto" || !context.env.gatewayApiKey) return;
      const abort = new AbortController();
      this.activeAbort = abort;
      let batch: Awaited<ReturnType<typeof embedPhotoBatch>>;
      try {
        batch = await embedPhotoBatch({
          handle: this.options.handle,
          env: context.env,
          cwd: context.cwd,
          afterId: this.afterId,
          limit: EMBED_PROVIDER_BATCH_SIZE,
          signal: abort.signal,
        });
      } finally {
        if (this.activeAbort === abort) this.activeAbort = undefined;
      }
      if (this.stopped || this.paused) return;
      const lastCandidate = batch.candidateIds.at(-1);
      if (lastCandidate) this.afterId = lastCandidate;
      if (batch.results.some((result) => !result.ok && result.code === "provider_unconfigured")) {
        this.configurationPaused = true;
        this.pendingKick = false;
        return;
      }
      if (batch.results.some((result) => !result.ok)) {
        this.failedInSweep = true;
        this.retryNotBefore ??= Date.now() + this.attemptCooldownMs();
      }
      if (batch.candidateIds.length >= EMBED_PROVIDER_BATCH_SIZE) {
        await this.sleep(timing.interBatchYieldMs);
        continue;
      }
      if (this.failedInSweep) {
        const retryDelay = Math.max(1, (this.retryNotBefore ?? Date.now()) - Date.now());
        this.cooldownSleeping = true;
        try {
          await this.sleep(retryDelay);
        } finally {
          this.cooldownSleeping = false;
        }
        if (this.stopped) return;
        this.resetSweep();
        continue;
      }
      this.resetSweep();
      if (this.pendingKick) continue;
      return;
    }
  }

  private resetSweep(): void {
    this.afterId = undefined;
    this.retryNotBefore = undefined;
    this.failedInSweep = false;
  }

  private attemptCooldownMs(): number {
    return this.options.attemptCooldownMs ?? 5 * 60_000;
  }

  private async sleep(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      this.wake = finish;
    });
  }
}
