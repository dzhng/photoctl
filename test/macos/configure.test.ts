import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

test.each([false, true])(
  "configure hides terminal input and cancellation leaves no file: cancel=%s",
  async (cancel) => {
    const home = mkdtempSync(join(tmpdir(), "openphoto-terminal-"));
    // Python's standard-library PTY gives the real CLI a terminal without a new dependency.
    const terminal = `
import os, pty, select, signal, sys
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
try:
    while True:
        ready, _, _ = select.select([fd, 0], [], [], 8)
        if not ready:
            raise TimeoutError("terminal timed out")
        for source in ready:
            data = os.read(source, 4096)
            if not data:
                raise EOFError()
            os.write(1 if source == fd else fd, data)
except (OSError, EOFError):
    pass
finally:
    os.close(fd)
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    os.waitpid(pid, 0)
`;
    const child = spawn(
      "python3",
      ["-c", terminal, process.execPath, resolve("apps/cli/dist/bin.js"), "configure"],
      {
        env: { ...process.env, HOME: home, AI_GATEWAY_API_KEY: "" },
      },
    );
    let output = "";
    let supplied = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Configuration prompt did not complete"));
        }, 10_000);
        const capture = (chunk: Buffer) => {
          output += chunk.toString();
          if (!supplied && output.includes("AI Gateway API key")) {
            supplied = true;
            child.stdin.write("terminal-secret");
            child.stdin.write(cancel ? "\x03" : "\r");
          }
        };
        child.stdout.on("data", capture);
        child.stderr.on("data", capture);
        child.once("error", reject);
        child.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      expect(supplied, output).toBe(true);
      expect(output).not.toContain("terminal-secret");
      const file = join(home, ".openphoto", ".env");
      if (cancel) {
        expect(output).toContain("Configuration cancelled");
        expect(existsSync(file)).toBe(false);
      } else {
        expect(output).toContain('"configured":true');
        expect(readFileSync(file, "utf8")).toContain("AI_GATEWAY_API_KEY=terminal-secret");
      }
    } finally {
      child.kill();
      rmSync(home, { recursive: true, force: true });
    }
  },
);
