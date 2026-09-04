import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

export interface ProcessTimingBudgets {
  spawnMs: number;
  lockBudgetMs: number;
  pollCeilingMs: number;
}

export async function measureProcessTiming(): Promise<ProcessTimingBudgets> {
  const startedAt = performance.now();
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(process.execPath, ["-e", ""]);
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`Node spawn probe exited with code ${code ?? "unknown"}`));
    });
  });
  const spawnMs = Math.max(1, Math.ceil(performance.now() - startedAt));
  return {
    spawnMs,
    lockBudgetMs: Math.max(1_000, spawnMs * 20),
    pollCeilingMs: Math.max(5, Math.min(100, spawnMs * 2)),
  };
}
