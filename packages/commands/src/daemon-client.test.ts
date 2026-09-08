import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { daemonSocketPath, IDLE_CEILING_MS, requestTimeout } from "./daemon-client.js";

test("daemon socket identity is stable and independent of library path length", () => {
  const library = `/tmp/${"library-segment/".repeat(20)}`;
  const first = daemonSocketPath(library, "0.1.0");

  expect(first).toBe(daemonSocketPath(library, "0.1.0"));
  expect(first).not.toBe(daemonSocketPath(library, "0.2.0"));
  expect(first.startsWith(`${tmpdir()}/photoctl-`)).toBe(true);
  expect(Buffer.byteLength(first)).toBeLessThanOrEqual(104);
});

test("every verb tolerates silence longer than a handler's progress interval", () => {
  for (const verb of ["fill", "layer", "develop", "import", "list", "embed", "show"]) {
    expect(
      requestTimeout({ verb, args: [], cwd: "/", env: { noDaemon: false, lockBudgetMs: "0" } }),
    ).toBe(IDLE_CEILING_MS);
  }
});

test("the idle ceiling still honors a longer foreground queue budget", () => {
  const timeout = requestTimeout({
    verb: "embed",
    args: ["0199a7c2-0000-7000-8000-000000000001"],
    cwd: "/",
    env: { noDaemon: false, lockBudgetMs: "60000" },
  });

  expect(timeout).toBe(61_000);
});

test("an invalid budget falls back to the default admission window", () => {
  expect(requestTimeout({ verb: "list", args: [], cwd: "/", env: { noDaemon: false } })).toBe(
    31_000,
  );
});
