import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import sharp from "sharp";
import { srgb2014ProfilePath } from "./color.js";
import type { ImageSource } from "./decoder.js";

export type PreviewSourceTier = ImageSource["kind"];

export interface PreviewProvenance {
  sourceTier: PreviewSourceTier;
  sourceDimensions: { w: number; h: number };
}

export interface ValidPreviewArtifact extends PreviewProvenance {
  bytes: Buffer;
  storageBytes: number;
  w: number;
  h: number;
}

export class PreviewDestinationError extends Error {
  readonly code = "volume_readonly";

  constructor(
    readonly path: string,
    readonly reason: unknown,
  ) {
    super(`Could not write preview cache: ${path}`);
  }
}

export async function readValidPreviewArtifact(
  path: string,
): Promise<ValidPreviewArtifact | undefined> {
  try {
    const bytes = await readFile(path);
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    await sharp(bytes, { failOn: "error" }).stats();
    const [expectedProfile, provenanceBytes] = await Promise.all([
      readFile(srgb2014ProfilePath),
      readFile(`${path}.json`),
    ]);
    const provenance = parseProvenance(provenanceBytes);
    if (
      metadata.format !== "jpeg" ||
      !metadata.width ||
      !metadata.height ||
      !metadata.icc?.equals(expectedProfile) ||
      provenance.jpegSha256 !== createHash("sha256").update(bytes).digest("hex")
    ) {
      return undefined;
    }
    return {
      bytes,
      storageBytes: bytes.length + provenanceBytes.length,
      w: metadata.width,
      h: metadata.height,
      sourceTier: provenance.sourceTier,
      sourceDimensions: provenance.sourceDimensions,
    };
  } catch {
    return undefined;
  }
}

export async function writePreviewArtifact(
  path: string,
  bytes: Uint8Array,
  provenance: PreviewProvenance,
): Promise<void> {
  const directory = dirname(path);
  await writeAtomically(path, directory, bytes);
  await writeAtomically(
    `${path}.json`,
    directory,
    Buffer.from(
      `${JSON.stringify({
        schema: 1,
        jpeg_sha256: createHash("sha256").update(bytes).digest("hex"),
        source_tier: provenance.sourceTier,
        source_dimensions: provenance.sourceDimensions,
      })}\n`,
    ),
  );
}

export async function removePreviewArtifact(path: string): Promise<void> {
  await Promise.all([rm(path, { force: true }), rm(`${path}.json`, { force: true })]);
}

export async function removePreviewTemps(path: string): Promise<void> {
  const directory = dirname(path);
  const prefix = `${basename(path)}.`;
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(prefix) && name.endsWith(".tmp"))
      .map(async (name) => await rm(`${directory}/${name}`, { force: true })),
  );
}

function parseProvenance(bytes: Buffer): PreviewProvenance & { jpegSha256: string } {
  const value = JSON.parse(bytes.toString("utf8")) as {
    schema?: unknown;
    jpeg_sha256?: unknown;
    source_tier?: unknown;
    source_dimensions?: { w?: unknown; h?: unknown };
  };
  if (
    value.schema !== 1 ||
    typeof value.jpeg_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.jpeg_sha256) ||
    !["online-file", "online-jpeg-range", "pinned-preview"].includes(value.source_tier as string) ||
    !Number.isSafeInteger(value.source_dimensions?.w) ||
    !Number.isSafeInteger(value.source_dimensions?.h) ||
    Number(value.source_dimensions?.w) <= 0 ||
    Number(value.source_dimensions?.h) <= 0
  ) {
    throw new Error("Invalid preview provenance");
  }
  return {
    jpegSha256: value.jpeg_sha256,
    sourceTier: value.source_tier as PreviewSourceTier,
    sourceDimensions: {
      w: Number(value.source_dimensions?.w),
      h: Number(value.source_dimensions?.h),
    },
  };
}

async function writeAtomically(path: string, directory: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory, { recursive: true });
    const output = await open(temporary, "w");
    try {
      await output.writeFile(bytes);
      await output.sync();
    } finally {
      await output.close();
    }
    await rename(temporary, path);
  } catch (error) {
    throw new PreviewDestinationError(path, error);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
