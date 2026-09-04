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
