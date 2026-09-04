import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function withLibrary<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "photoctl-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
