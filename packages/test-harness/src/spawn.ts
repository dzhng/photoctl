import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { Envelope, StderrEvent } from "@photoctl/protocol";
export interface SpawnOptions {
  libraryDir?: string;
  env?: NodeJS.ProcessEnv;
}
export interface SpawnResult {
  code: number;
  json: Envelope;
  events: StderrEvent[];
}
export async function spawnPhotoctl(
  args: string[],
  options: SpawnOptions = {},
): Promise<SpawnResult> {
  const cli = resolve(process.cwd(), "apps/cli/dist/bin.js");
  return await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: {
        ...process.env,
        PHOTOCTL_NO_DAEMON: "1",
        ...(options.libraryDir ? { PHOTOCTL_LIBRARY: options.libraryDir } : {}),
        ...options.env,
      },
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        resolveResult({
          code: code ?? 1,
          json: JSON.parse(stdout),
          events: stderr.trim()
            ? stderr
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line))
            : [],
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}
