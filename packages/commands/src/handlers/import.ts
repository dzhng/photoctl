import { PhotoctlError, type Envelope, type ImportData } from "@photoctl/protocol";
import {
  createVolumeResolver,
  identifyFile,
  newLibraryEntityId,
  type VolumeResolver,
} from "@photoctl/library";
import {
  cacheRootForLibrary,
  classifyFormat,
  indexEmbeddedJpegs,
  pinEmbeddedJpeg,
  readExif,
  type EmbeddedJpeg,
} from "@photoctl/importer";
import { orientedDimensions, parseExifOrientation } from "@photoctl/render";
import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { hasErrorCode } from "../errors.js";

export async function importCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
): Promise<Envelope> {
  const startedAt = performance.now();
  const parsed = parseArguments(args, { flags: ["--link"] });
  if (parsed.positionals.length !== 1) {
    throw new PhotoctlError("usage", "import requires exactly one file path");
  }
  const sourcePath = resolve(cwd, parsed.positionals[0]);
  const format = classifyFormat(sourcePath);
  if (!format) return unsupportedImport(startedAt);

  const resolver = createVolumeResolver(env.volumeMap);
  const volume = await locateSource(sourcePath, resolver);
  if (!volume.online) throw new PhotoctlError("file_offline", `Source is offline: ${sourcePath}`);
  const identity = await identifySource(sourcePath);
  const { exif, embedded } = await inspectSource(sourcePath, format.source);
  const orientation = parseExifOrientation(exif.orientation);
  const dimensions = orientedDimensions(exif.dimensions, orientation);

  const handle = await openRequestLibrary(env, cwd);
  let pinnedPath: string | undefined;
  try {
    const existing = await handle.query<{ id: string }>(
      "SELECT id::text AS id FROM photos WHERE content_key = $1",
      [identity.contentKey],
    );
    const alreadyPresent = existing.rows[0] !== undefined;
    const photoId = existing.rows[0]?.id ?? newLibraryEntityId();
    const fileId = newLibraryEntityId();
    const libraryId = await readLibraryId(handle);
    const pinnedTier = choosePinnedTier(embedded);
    if (pinnedTier) {
      const pinned = await pinEmbeddedJpeg(
        cacheRootForLibrary(libraryId, cacheBase(env, cwd)),
        photoId,
        sourcePath,
        pinnedTier,
      );
      pinnedPath = pinned.path;
    }

    await handle.query("BEGIN");
    try {
      const after = await stat(sourcePath);
      if (after.size !== identity.size || after.mtime.getTime() !== identity.mtime.getTime()) {
        throw new Error(`File changed during import: ${sourcePath}`);
      }
      await handle.query(
        `INSERT INTO volumes (uuid, label, last_mount, last_seen)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (uuid) DO UPDATE
         SET label = EXCLUDED.label, last_mount = EXCLUDED.last_mount, last_seen = EXCLUDED.last_seen`,
        [volume.uuid, volume.label, volume.mount],
      );
      if (!alreadyPresent) {
        await handle.query(
          `INSERT INTO photos
             (id, content_key, size, w, h, orientation, camera, exposure, shot_at, shot_offset_min)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
          [
            photoId,
            identity.contentKey,
            identity.size,
            dimensions.w,
            dimensions.h,
            orientation,
            JSON.stringify(exif.camera),
            JSON.stringify(exif.exposure),
            exif.shotAt?.toISOString() ?? null,
            exif.shotOffsetMin,
          ],
        );
      }
      await handle.query(
        `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime, embedded)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (volume_uuid, rel_path) DO UPDATE
         SET photo_id = EXCLUDED.photo_id, mtime = EXCLUDED.mtime, embedded = EXCLUDED.embedded`,
        [
          fileId,
          photoId,
          volume.uuid,
          volume.relPath,
          identity.mtime.toISOString(),
          JSON.stringify(embedded),
        ],
      );
      if (pinnedPath) {
        await handle.query(
          `INSERT INTO cache_index (path, bytes, last_used, pinned)
           VALUES ($1, $2, now(), true)
           ON CONFLICT (path) DO UPDATE
           SET bytes = EXCLUDED.bytes, last_used = EXCLUDED.last_used, pinned = true`,
          [`emb/${photoId}.jpg`, pinnedTier?.length ?? 0],
        );
      }
      await handle.query("COMMIT");
    } catch (error) {
      await handle.query("ROLLBACK");
      if (pinnedPath && !alreadyPresent) await rm(pinnedPath, { force: true });
      throw error;
    }

    return success({
      imported: alreadyPresent ? 0 : 1,
      already_present: alreadyPresent ? 1 : 0,
      skipped_unsupported: 0,
      ids: [photoId],
      volume: { uuid: volume.uuid, mount: volume.mount, online: volume.online },
      xmp_read: zeroXmpRead(),
      previews: {
        embedded_extracted: pinnedPath ? 1 : 0,
        bytes: pinnedPath ? (pinnedTier?.length ?? 0) : 0,
      },
      embeddings: { queued: 0, note: "not queued" },
      elapsed_s: elapsedSeconds(startedAt),
    });
  } finally {
    await handle.close();
  }
}

async function locateSource(sourcePath: string, resolver: VolumeResolver) {
  try {
    return await resolver.locate(sourcePath);
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    if (hasErrorCode(error, "ENOENT")) {
      throw new PhotoctlError("not_found", `File not found: ${sourcePath}`, { path: sourcePath });
    }
    throw unsupportedSource(sourcePath);
  }
}

async function identifySource(sourcePath: string) {
  try {
    return await identifyFile(sourcePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw new PhotoctlError("not_found", `File not found: ${sourcePath}`, { path: sourcePath });
    }
    throw unsupportedSource(sourcePath);
  }
}

async function inspectSource(sourcePath: string, source: "embedded" | "file") {
  try {
    const [exif, embedded] = await Promise.all([
      readExif(sourcePath),
      source === "embedded" ? indexEmbeddedJpegs(sourcePath) : Promise.resolve([]),
    ]);
    return { exif, embedded };
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    throw unsupportedSource(sourcePath);
  }
}

function unsupportedImport(startedAt: number): Envelope<ImportData> {
  return success({
    imported: 0,
    already_present: 0,
    skipped_unsupported: 1,
    ids: [],
    volume: null,
    xmp_read: zeroXmpRead(),
    previews: { embedded_extracted: 0, bytes: 0 },
    embeddings: { queued: 0, note: "not queued" },
    elapsed_s: elapsedSeconds(startedAt),
  });
}

function choosePinnedTier(previews: EmbeddedJpeg[]): EmbeddedJpeg | undefined {
  return previews.find((preview) => preview.width === 1616 && preview.height === 1080);
}

function success(data: ImportData): Envelope<ImportData> {
  return { schema: 1, ok: true, data, warnings: [] };
}

function zeroXmpRead() {
  return { sidecars_found: 0, ratings: 0, keywords: 0, labels: 0 };
}

function elapsedSeconds(startedAt: number): number {
  return (performance.now() - startedAt) / 1000;
}

function unsupportedSource(path: string): PhotoctlError {
  return new PhotoctlError("unsupported_file", `Cannot read supported file: ${path}`, { path });
}
