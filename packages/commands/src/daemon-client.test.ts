import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { daemonSocketPath, requestTimeout } from "./daemon-client.js";

test("daemon socket identity is stable and independent of library path length", () => {
  const library = `/tmp/${"library-segment/".repeat(20)}`;
  const first = daemonSocketPath(library, "0.1.0");

  expect(first).toBe(daemonSocketPath(library, "0.1.0"));
  expect(first).not.toBe(daemonSocketPath(library, "0.2.0"));
  expect(first.startsWith(`${tmpdir()}/photoctl-`)).toBe(true);
  expect(Buffer.byteLength(first)).toBeLessThanOrEqual(104);
});

test("drive-scale imports are not capped by the ordinary command timeout", () => {
  const timeout = requestTimeout({
    verb: "import",
    args: ["/Volumes/drive", "--link"],
    cwd: "/",
    env: { noDaemon: false },
  });

  expect(timeout).toBeGreaterThanOrEqual(5 * 60 * 1_000);
});

test("embed idle timeout always leaves room for provider progress frames", () => {
  const timeout = requestTimeout({
    verb: "embed",
    args: ["0199a7c2-0000-7000-8000-000000000001"],
    cwd: "/",
    env: { noDaemon: false, lockBudgetMs: "0" },
  });

  expect(timeout).toBeGreaterThan(5_000);
});

test("search idle timeout always leaves room for provider progress frames", () => {
  const timeout = requestTimeout({
    verb: "search",
    args: ["ceremony"],
    cwd: "/",
    env: { noDaemon: false, lockBudgetMs: "0" },
  });

  expect(timeout).toBeGreaterThan(5_000);
});

test("reimagine idle timeout always leaves room for provider progress frames", () => {
  const timeout = requestTimeout({
    verb: "reimagine",
    args: ["0199a7c2-0000-7000-8000-000000000001", "--prompt", "twilight"],
    cwd: "/",
    env: { noDaemon: false, lockBudgetMs: "0" },
  });

  expect(timeout).toBeGreaterThan(5_000);
});

test("relight idle timeout always leaves room for provider progress frames", () => {
  const timeout = requestTimeout({
    verb: "relight",
    args: [
      "0199a7c2-0000-7000-8000-000000000001",
      "--azimuth",
      "35",
      "--elevation",
      "60",
      "--intensity",
      "0.75",
    ],
    cwd: "/",
    env: { noDaemon: false, lockBudgetMs: "0" },
  });

  expect(timeout).toBeGreaterThan(5_000);
});

test("embed timeout still honors a longer foreground queue budget", () => {
  const timeout = requestTimeout({
    verb: "embed",
    args: ["0199a7c2-0000-7000-8000-000000000001"],
    cwd: "/",
    env: { noDaemon: false, lockBudgetMs: "60000" },
  });

  expect(timeout).toBe(61_000);
});

test("export idle timeout permits heartbeat frames even with immediate queue admission", () => {
  const timeout = requestTimeout({
    verb: "export",
    args: ["0199a7c2-0000-7000-8000-000000000001", "--to", "/tmp/delivery"],
    cwd: "/",
    env: { noDaemon: false, lockBudgetMs: "0" },
  });

  expect(timeout).toBeGreaterThan(5_000);
});
