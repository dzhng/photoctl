import { randomUUID } from "node:crypto";
import { copyFile, open, rename, rm, utimes } from "node:fs/promises";
import { dirname } from "node:path";

export async function publishDurableFile(
  path: string,
  contents: string,
  options: { mode?: number; timestamp?: Date } = {},
): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let published = false;
  try {
    const file = await open(temporary, "wx", options.mode ?? 0o600);
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    published = true;
    if (options.timestamp) await utimes(path, options.timestamp, options.timestamp);
    await syncDirectory(dirname(path));
  } finally {
    if (!published) await rm(temporary, { force: true });
  }
}

export async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function copyDurableFile(source: string, target: string): Promise<void> {
  await copyFile(source, target);
  const file = await open(target, "r+");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
