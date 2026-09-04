import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, parse } from "node:path";

export interface TrashReceipt {
  original: string;
  destination: string;
  rollback(): Promise<void>;
  commit(): Promise<void>;
}

export interface Trash {
  move(path: string): Promise<TrashReceipt>;
}

export class DirTrash implements Trash {
  constructor(private readonly root: string) {}

  async move(path: string): Promise<TrashReceipt> {
    return await moveWithReceipt(path, join(this.root, ".trash"));
  }
}

export class MacTrash implements Trash {
  constructor(
    private readonly volumeMount: string,
    private readonly userId = process.getuid?.() ?? 0,
    private readonly userHome = homedir(),
  ) {}

  async move(path: string): Promise<TrashReceipt> {
    const root = parse(path).root;
    const directory =
      this.volumeMount === root
        ? join(this.userHome, ".Trash")
        : join(this.volumeMount, ".Trashes", String(this.userId));
    return await moveWithReceipt(path, directory);
  }
}

export async function stageFileRemoval(path: string): Promise<TrashReceipt | undefined> {
  const destination = join(dirname(path), `.${basename(path)}.${randomUUID()}.remove`);
  try {
    await rename(path, destination);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
  return receipt(path, destination, true);
}

async function moveWithReceipt(path: string, directory: string): Promise<TrashReceipt> {
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `${basename(path)}.${randomUUID()}`);
  await rename(path, destination);
  return receipt(path, destination, false);
}

function receipt(original: string, destination: string, deleteOnCommit: boolean): TrashReceipt {
  let settled = false;
  return {
    original,
    destination,
    rollback: async () => {
      if (settled) return;
      await rename(destination, original);
      settled = true;
    },
    commit: async () => {
      if (settled) return;
      if (deleteOnCommit) await rm(destination, { force: true, recursive: true });
      settled = true;
    },
  };
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
