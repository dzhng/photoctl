import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLibraryLock, shouldReclaimLock, STALE_LOCK_MS } from "./lock.js";

test("an unknown lock owner is reclaimed only after the age threshold", () => {
  const payload = { pid: 42, socket: null, startedAt: 1 };

  expect(
    shouldReclaimLock({ payload, ageMs: STALE_LOCK_MS, currentPid: 7, liveness: "unknown" }),
  ).toBe(false);
  expect(
    shouldReclaimLock({
      payload,
      ageMs: STALE_LOCK_MS + 1,
      currentPid: 7,
      liveness: "unknown",
    }),
  ).toBe(true);
});

test("the current process can reclaim its orphaned lock file", () => {
  expect(
    shouldReclaimLock({
      payload: { pid: 7, socket: null, startedAt: 1 },
      ageMs: 0,
      currentPid: 7,
      liveness: "alive",
    }),
  ).toBe(true);
});

test("a second handle cannot steal an active same-process lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-same-process-lock-"));
  const path = join(directory, ".photoctl-open.lock");
  const first = await acquireLibraryLock(path);
  try {
    await expect(acquireLibraryLock(path, 20)).rejects.toMatchObject({
      code: "library_locked",
      data: { holder_pid: process.pid, waited_ms: 20 },
    });
  } finally {
    await first.release();
    await rm(directory, { recursive: true });
  }
});
