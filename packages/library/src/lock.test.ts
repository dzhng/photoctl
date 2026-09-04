import { expect, test } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acquireLibraryLock } from "./lock.js";

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

test("concurrent contenders cannot both reclaim one dead holder", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-stale-lock-race-"));
  const path = join(directory, ".photoctl-open.lock");
  await writeFile(
    path,
    JSON.stringify({ pid: 2_147_483_647, socket: null, startedAt: Date.now() }),
  );
  const moduleUrl = pathToFileURL(resolve("packages/library/dist/lock.js")).href;
  const script = `
    const { acquireLibraryLock } = await import(${JSON.stringify(moduleUrl)});
    process.stdout.write("WAITING\\n");
    await new Promise((resolve) => process.stdin.once("data", resolve));
    const lock = await acquireLibraryLock(process.argv[1], 5000);
    process.stdout.write("READY\\n");
    await new Promise((resolve) => process.stdin.once("data", resolve));
    await lock.release();
  `;
  const contenders = Array.from({ length: 4 }, () =>
    spawn(process.execPath, ["--input-type=module", "--eval", script, path], {
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
  try {
    await Promise.all(contenders.map((child) => waitForOutput(child, "WAITING")));
    const readyChildren = new Set<ChildProcessWithoutNullStreams>();
    let resolveFirstReady: () => void;
    const firstReady = new Promise<void>((resolveReady) => {
      resolveFirstReady = resolveReady;
    });
    for (const child of contenders) {
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("READY")) {
          readyChildren.add(child);
          resolveFirstReady();
        }
      });
    }
    for (const child of contenders) child.stdin.write("go\n");
    await Promise.race([
      firstReady,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("No contender acquired the lock")), 5_000),
      ),
    ]);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
    expect(readyChildren.size).toBe(1);
  } finally {
    for (const child of contenders) child.kill("SIGKILL");
    await Promise.all(contenders.map(waitForExit));
    await rm(directory, { recursive: true, force: true });
  }
});

async function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  expected: string,
): Promise<void> {
  await new Promise<void>((resolveOutput, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes(expected)) resolveOutput();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes(expected)) reject(new Error(`Contender exited ${code}: ${output}`));
    });
  });
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
}
