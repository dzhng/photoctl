import { PhotoctlError, type Envelope, type ImportData } from "@photoctl/protocol";
import {
  createVolumeResolver,
  identifyFile,
  newLibraryEntityId,
  type VolumeResolver,
} from "@photoctl/library";
import {
  cacheRootForLibrary,
  createDecodedPreviewJpeg,
  createEmbeddedPreviewJpeg,
  pinPreviewBytes,
  pinnedPreviewMatches,
  PinnedPreviewDestinationError,
  PinnedPreviewSourceError,
  probeImage,
  type ImageProbe,
  readExif,
} from "@photoctl/importer";
import { orientedDimensions, parseExifOrientation } from "@photoctl/render";
import { constants } from "node:fs";
import { access, copyFile, mkdir, rm, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { parseArguments } from "../arguments.js";
import {
  cacheBase,
  libraryPath,
  openRequestLibrary,
  readLibraryId,
  type RequestEnv,
} from "../context.js";
import { cacheWriteError, sourceChangedError, sourceReadError } from "../errors.js";

export async function importCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
): Promise<Envelope> {
  const startedAt = performance.now();
  const parsed = parseArguments(args, { flags: ["--link", "--copy"] });
  if (parsed.positionals.length !== 1) {
    throw new PhotoctlError("usage", "import requires exactly one file or folder path");
  }
  const sourcePath = resolve(cwd, parsed.positionals[0]);
  let sourceStat;
  try {
    sourceStat = await stat(sourcePath);
  } catch (error) {
    throw sourceReadError(error, sourcePath);
  }
  if (!sourceStat.isFile()) {
    throw new PhotoctlError(
      "usage",
      "directory import lands with the recursive scanner in slice 04",
      {
        path: sourcePath,
      },
    );
  }
  const modes = Number(parsed.flags.has("--link")) + Number(parsed.flags.has("--copy"));
  if (modes !== 1)
    throw new PhotoctlError("usage", "import requires exactly one of --link or --copy");
  return await importFile(sourcePath, parsed.flags.has("--copy"), env, cwd, startedAt);
}

async function importFile(
  sourcePath: string,
  copy: boolean,
  env: RequestEnv,
  cwd: string,
  startedAt: number,
): Promise<Envelope<ImportData>> {
  const resolver = createVolumeResolver(env.volumeMap);
  const sourceVolume = await locateSource(sourcePath, resolver);
  if (!sourceVolume.online) {
    throw new PhotoctlError("file_offline", `Source is offline: ${sourcePath}`);
  }
  const probe = await probeImage(sourcePath);
  if (!probe) return unsupportedImport(startedAt);
  const originalIdentity = await identifySource(sourcePath);
  const exif = await inspectSource(sourcePath, probe);
  const orientation = parseExifOrientation(exif.orientation);
  const dimensions = orientedDimensions(exif.dimensions, orientation);

  const handle = await openRequestLibrary(env, cwd);
  let pinnedPath: string | undefined;
  let copiedPath: string | undefined;
  try {
    const existing = await handle.query<{ id: string }>(
      "SELECT id::text AS id FROM photos WHERE content_key = $1",
      [originalIdentity.contentKey],
    );
    const alreadyPresent = existing.rows[0] !== undefined;
    const photoId = existing.rows[0]?.id ?? newLibraryEntityId();
    const copied = copy
      ? await copyIntoLibrary(
          sourcePath,
          libraryPath(env, cwd),
          exif.shotAt,
          photoId,
          originalIdentity.contentKey,
        )
      : undefined;
    copiedPath = copied?.created ? copied.path : undefined;
    const storedSourcePath = copied?.path ?? sourcePath;
    const identity = copy ? await identifySource(storedSourcePath) : originalIdentity;
    if (
      identity.contentKey !== originalIdentity.contentKey ||
      identity.size !== originalIdentity.size
    ) {
      throw sourceChangedError(sourcePath);
    }
    const volume = copy ? await locateSource(storedSourcePath, resolver) : sourceVolume;
    if (!volume.online) {
      throw new PhotoctlError("file_offline", `Source is offline: ${storedSourcePath}`);
    }
    const fileId = newLibraryEntityId();
    const libraryId = await readLibraryId(handle);
    const cacheRoot = cacheRootForLibrary(libraryId, cacheBase(env, cwd));
    let preview: PreparedPreview;
    try {
      preview = await preparePreview(cacheRoot, photoId, storedSourcePath, probe, orientation);
      if (!preview.matches) {
        const pinned = await pinPreviewBytes(cacheRoot, photoId, preview.bytes);
        pinnedPath = pinned.path;
      }
    } catch (error) {
      if (error instanceof PinnedPreviewDestinationError) throw cacheWriteError(cacheRoot);
      if (error instanceof PinnedPreviewSourceError) {
        throw sourceReadError(error.reason, storedSourcePath);
      }
      throw error;
    }

    await handle.query("BEGIN");
    try {
      const after = await stat(storedSourcePath);
      if (after.size !== identity.size || after.mtime.getTime() !== identity.mtime.getTime()) {
        throw sourceChangedError(sourcePath);
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
          JSON.stringify(probe.embedded),
        ],
      );
      await handle.query(
        `INSERT INTO cache_index (path, bytes, last_used, pinned)
         VALUES ($1, $2, now(), true)
         ON CONFLICT (path) DO UPDATE
         SET bytes = EXCLUDED.bytes, last_used = EXCLUDED.last_used, pinned = true`,
        [`emb/${photoId}.jpg`, preview.bytesLength],
      );
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
        bytes: pinnedPath ? preview.bytesLength : 0,
      },
      embeddings: { queued: 0, note: "not queued" },
      elapsed_s: elapsedSeconds(startedAt),
    });
  } catch (error) {
    if (copiedPath) await rm(copiedPath, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
}

async function locateSource(sourcePath: string, resolver: VolumeResolver) {
  try {
    return await resolver.locate(sourcePath);
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    throw sourceReadError(error, sourcePath);
  }
}

async function identifySource(sourcePath: string) {
  try {
    return await identifyFile(sourcePath);
  } catch (error) {
    throw sourceReadError(error, sourcePath);
  }
}

async function inspectSource(sourcePath: string, probe: ImageProbe) {
  try {
    return await readExif(sourcePath, probe.dimensions);
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    throw sourceReadError(error, sourcePath);
  }
}

interface PreparedPreview {
  bytes: Buffer;
  matches: boolean;
  bytesLength: number;
}

async function preparePreview(
  cacheRoot: string,
  photoId: string,
  sourcePath: string,
  probe: ImageProbe,
  orientation: number,
): Promise<PreparedPreview> {
  if (probe.preview.kind === "embedded-jpeg") {
    try {
      const bytes = await createEmbeddedPreviewJpeg(sourcePath, probe.preview.range, orientation);
      return {
        bytes,
        matches: await pinnedPreviewMatches(cacheRoot, photoId, bytes),
        bytesLength: bytes.length,
      };
    } catch (error) {
      throw new PinnedPreviewSourceError(error);
    }
  }
  let bytes: Buffer;
  try {
    bytes = await createDecodedPreviewJpeg(sourcePath);
  } catch (error) {
    throw new PinnedPreviewSourceError(error);
  }
  return {
    bytes,
    matches: await pinnedPreviewMatches(cacheRoot, photoId, bytes),
    bytesLength: bytes.length,
  };
}

async function copyIntoLibrary(
  sourcePath: string,
  library: string,
  shotAt: Date | null,
  photoId: string,
  contentKey: string,
): Promise<{ path: string; created: boolean }> {
  const directory = join(library, "originals", shotAt?.toISOString().slice(0, 10) ?? "undated");
  try {
    await mkdir(directory, { recursive: true });
    const sourceName = basename(sourcePath);
    const extension = extname(sourceName);
    const stem = basename(sourceName, extension);
    const preferred = join(directory, sourceName);
    const destination = (await pathExists(preferred))
      ? join(directory, `${stem}_${photoId.replaceAll("-", "").slice(-8)}${extension}`)
      : preferred;
    if (await pathExists(destination)) {
      const existing = await identifySource(destination);
      if (existing.contentKey !== contentKey) {
        throw new PhotoctlError("volume_readonly", "Copy destination already exists", {
          path: destination,
        });
      }
      return { path: destination, created: false };
    }
    await copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
    return { path: destination, created: true };
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    if (isErrorAtPath(error, sourcePath)) throw sourceReadError(error, sourcePath);
    throw cacheWriteError(directory);
  }
}

function isErrorAtPath(error: unknown, path: string): boolean {
  return error instanceof Error && "path" in error && error.path === path;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
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

function success(data: ImportData): Envelope<ImportData> {
  return { schema: 1, ok: true, data, warnings: [] };
}

function zeroXmpRead() {
  return { sidecars_found: 0, ratings: 0, keywords: 0, labels: 0 };
}

function elapsedSeconds(startedAt: number): number {
  return (performance.now() - startedAt) / 1000;
}
