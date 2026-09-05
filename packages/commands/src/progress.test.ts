import { expect, test } from "vitest";
import { createProgressHeartbeat } from "./progress.js";

test("stop during an asynchronous report does not schedule another interval", async () => {
  let reports = 0;
  let reportStarted!: () => void;
  let releaseReport!: () => void;
  const secondReportStarted = new Promise<void>((resolve) => {
    reportStarted = resolve;
  });
  const heldReport = new Promise<void>((resolve) => {
    releaseReport = resolve;
  });
  const progress = createProgressHeartbeat({
    phase: "search",
    total: 1,
    intervalMs: 1_000,
    emit: async () => {
      reports += 1;
      if (reports === 2) {
        reportStarted();
        await heldReport;
      }
    },
  });

  await progress.start();
  await secondReportStarted;
  const stopping = progress.stop();
  releaseReport();
  const stoppedPromptly = await Promise.race([
    stopping.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
  ]);
  await stopping;

  expect(stoppedPromptly).toBe(true);
  expect(reports).toBe(2);
});

test("heartbeat owns an asynchronous emit rejection until stop", async () => {
  let reports = 0;
  let rejected!: () => void;
  const rejectionObserved = new Promise<void>((resolve) => {
    rejected = resolve;
  });
  const progress = createProgressHeartbeat({
    phase: "search",
    total: 1,
    intervalMs: 1,
    emit: () => {
      reports += 1;
      if (reports === 2) {
        rejected();
        throw new Error("event channel closed");
      }
    },
  });

  await progress.start();
  await rejectionObserved;

  await expect(progress.stop()).rejects.toThrow("event channel closed");
});
