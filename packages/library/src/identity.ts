import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { v7 as uuidv7 } from "uuid";

const SAMPLE_BYTES = 1024 * 1024;

export interface FileIdentity {
  contentKey: string;
  size: number;
  mtime: Date;
}

export function newLibraryEntityId(): string {
  return uuidv7();
}

export async function identifyFile(path: string): Promise<FileIdentity> {
  const file = await open(path, "r");
  try {
    const before = await file.stat();
    if (!Number.isSafeInteger(before.size) || before.size < 0) {
      throw new Error(`Cannot identify a file of this size: ${path}`);
    }

    const sizeBytes = Buffer.allocUnsafe(8);
    sizeBytes.writeBigUInt64LE(BigInt(before.size));
    const hash = createHash("sha256").update(sizeBytes);
    if (before.size < SAMPLE_BYTES * 2) {
      hash.update(await readExactly(file, before.size, 0));
    } else {
      hash.update(await readExactly(file, SAMPLE_BYTES, 0));
      hash.update(await readExactly(file, SAMPLE_BYTES, before.size - SAMPLE_BYTES));
    }

    const after = await file.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`File changed while its identity was being read: ${path}`);
    }
    return {
      contentKey: `ck_${hash.digest("hex").slice(0, 16)}`,
      size: before.size,
      mtime: before.mtime,
    };
  } finally {
    await file.close();
  }
}

async function readExactly(
  file: Awaited<ReturnType<typeof open>>,
  length: number,
  position: number,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length);
  async function readFrom(offset: number): Promise<Buffer> {
    if (offset === length) return buffer;
    const result = await file.read(buffer, offset, length - offset, position + offset);
    if (result.bytesRead === 0) throw new Error("File ended while its identity was being read");
    return await readFrom(offset + result.bytesRead);
  }
  return await readFrom(0);
}
