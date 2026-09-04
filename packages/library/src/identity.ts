import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { v7 as uuidv7 } from "uuid";
import type { PGlite } from "@electric-sql/pglite";
import { PhotoctlError } from "@photoctl/protocol";
import type { VolumeResolver } from "./locators.js";

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

export async function fullFileHash(path: string): Promise<string> {
  const file = await open(path, "r");
  try {
    const before = await file.stat();
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await file.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`File changed while its full identity was being read: ${path}`);
    }
    return `sha256_${hash.digest("hex")}`;
  } finally {
    await file.close();
  }
}

export interface ResolvedContentIdentity {
  photoId: string;
  contentHash: string | null;
}

export async function resolveContentIdentity(
  db: Pick<PGlite, "query">,
  candidatePath: string,
  identity: FileIdentity,
  volumeUuid: string,
  relPath: string,
  resolver: VolumeResolver,
): Promise<ResolvedContentIdentity> {
  const exact = await db.query<{ id: string; content_hash: string | null; mtime: string }>(
    `SELECT p.id::text, p.content_hash, f.mtime::text
     FROM photos p JOIN files f ON f.photo_id = p.id
     WHERE p.content_key = $1 AND f.volume_uuid = $2 AND f.rel_path = $3`,
    [identity.contentKey, volumeUuid, relPath],
  );
  if (exact.rows[0]) {
    if (
      exact.rows[0].content_hash === null &&
      new Date(exact.rows[0].mtime).getTime() !== identity.mtime.getTime()
    ) {
      throw new PhotoctlError(
        "unsupported_file",
        "The file at this locator changed before its full identity was recorded",
        { id: exact.rows[0].id, path: candidatePath },
      );
    }
    if (
      exact.rows[0].content_hash !== null &&
      (await fullFileHash(candidatePath)) !== exact.rows[0].content_hash
    ) {
      throw new PhotoctlError(
        "unsupported_file",
        "The file at this locator no longer matches its photo",
        {
          id: exact.rows[0].id,
          path: candidatePath,
        },
      );
    }
    return { photoId: exact.rows[0].id, contentHash: exact.rows[0].content_hash };
  }
  const matches = await db.query<{ id: string; content_hash: string | null }>(
    "SELECT id::text, content_hash FROM photos WHERE content_key = $1 ORDER BY id",
    [identity.contentKey],
  );
  if (matches.rows.length === 0) return { photoId: newLibraryEntityId(), contentHash: null };

  for (const match of matches.rows.filter((row) => row.content_hash === null)) {
    const locators = await db.query<{ volume_uuid: string; rel_path: string }>(
      "SELECT volume_uuid, rel_path FROM files WHERE photo_id = $1 ORDER BY id",
      [match.id],
    );
    let readable: string | undefined;
    let missingOnCandidateVolume = false;
    for (const locator of locators.rows) {
      const resolved = await resolver.resolve(locator.volume_uuid, locator.rel_path);
      if (resolved.online && resolved.path) {
        readable = resolved.path;
        break;
      }
      if (locator.volume_uuid === volumeUuid && resolved.mount !== null) {
        missingOnCandidateVolume = true;
      }
    }
    if (!readable) {
      if (missingOnCandidateVolume) return { photoId: match.id, contentHash: null };
      throw new PhotoctlError(
        "file_offline",
        "A sampled identity collision cannot be resolved while its existing source is offline",
        { content_key: identity.contentKey, existing_id: match.id },
      );
    }
    const existingHash = await fullFileHash(readable);
    await db.query("UPDATE photos SET content_hash = $2 WHERE id = $1 AND content_hash IS NULL", [
      match.id,
      existingHash,
    ]);
    match.content_hash = existingHash;
  }

  const candidateHash = await fullFileHash(candidatePath);
  const duplicate = matches.rows.find((row) => row.content_hash === candidateHash);
  return duplicate
    ? { photoId: duplicate.id, contentHash: candidateHash }
    : { photoId: newLibraryEntityId(), contentHash: candidateHash };
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
