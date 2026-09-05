import {
  LIBRARY_VOLUME_UUID,
  applyImportedXmp,
  createVolumeResolver,
  fullFileHash,
  identifyFile,
  newLibraryEntityId,
  readXmpSidecar,
  resolveContentIdentity,
  stageFileRemoval,
  type LibraryHandle,
  type ReadXmp,
  type TrashReceipt,
  type VolumeLocation,
  type VolumeResolver,
} from "@photoctl/library";
import {
  cacheRootForLibrary,
  createDecodedPreviewJpeg,
  createEmbeddedPreviewJpeg,
  consumeBoundedOrdered,
  pinPreviewBytes,
  pinnedEmbeddedJpegPath,
  pinnedPreviewMatches,
  probeImage,
  readExif,
  scanCandidates,
  type ImageProbe,
} from "@photoctl/importer";
import {
  PhotoctlError,
  type Envelope,
  type ImportData,
  type StderrEvent,
  type Warning,
} from "@photoctl/protocol";
import {
  commitRevisionInTransaction,
  orientedDimensions,
  parseExifOrientation,
  type CommitRevisionRequest,
  type CommitRevisionResult,
} from "@photoctl/render";
import { estimateEmbeddingCost, readProviderSettings, resolveModels } from "@photoctl/providers";
import { constants } from "node:fs";
import { access, copyFile, mkdir, realpath, rm, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { cacheWriteError, sourceChangedError, sourceReadError } from "../errors.js";

const IMPORT_CONCURRENCY = 4;

export async function importCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  emit?: (event: StderrEvent) => void | Promise<void>,
): Promise<Envelope> {
  const startedAt = performance.now();
  const parsed = parseArguments(args, { flags: ["--link", "--copy", "--recursive"] });
  if (parsed.positionals.length !== 1) {
    throw new PhotoctlError("usage", "import requires exactly one file or folder path");
  }
  const modes = Number(parsed.flags.has("--link")) + Number(parsed.flags.has("--copy"));
  if (modes !== 1) {
    throw new PhotoctlError("usage", "import requires exactly one of --link or --copy");
  }
  const sourcePath = resolve(cwd, parsed.positionals[0]);
  try {
    await stat(sourcePath);
  } catch (error) {
    throw sourceReadError(error, sourcePath);
  }
  let candidates: string[];
  try {
    candidates = await scanCandidates(sourcePath, parsed.flags.has("--recursive"));
  } catch (error) {
    throw sourceReadError(error, sourcePath);
  }
  await emit?.({
    event: "progress",
    phase: "scan",
    done: candidates.length,
    total: candidates.length,
  });
  const externalResolver = createVolumeResolver(env.volumeMap);
  const rootVolume = await locateSource(sourcePath, externalResolver);
  if (!rootVolume.online)
    throw new PhotoctlError("file_offline", `Source is offline: ${sourcePath}`);
  const lease = await openRequestLibrary(env, cwd, provided);
  const { handle } = lease;
  const resolver = createVolumeResolver(env.volumeMap, handle.path);
  const libraryId = await readLibraryId(handle);
  const cacheRoot = cacheRootForLibrary(libraryId, cacheBase(env, cwd));
  const warnings: Warning[] = [];
  const ids: string[] = [];
  let imported = 0;
  let alreadyPresent = 0;
  let skippedUnsupported = 0;
  let sidecarsFound = 0;
  let ratings = 0;
  let keywords = 0;
  let labels = 0;
  let embeddedExtracted = 0;
  let previewBytes = 0;
  try {
    await consumeBoundedOrdered(
      candidates,
      IMPORT_CONCURRENCY,
      async (path) => await prepareCandidate(path, externalResolver),
      async (candidate, index) => {
        if (!candidate) {
          skippedUnsupported += 1;
        } else {
          const result = await commitCandidate({
            candidate,
            copy: parsed.flags.has("--copy"),
            handle,
            resolver,
            cacheRoot,
            libraryPath: handle.path,
          });
          ids.push(result.photoId);
          imported += Number(!result.alreadyPresent);
          alreadyPresent += Number(result.alreadyPresent);
          embeddedExtracted += Number(result.previewWritten);
          previewBytes += result.previewWritten ? candidate.preview.length : 0;
          if (candidate.xmp) {
            sidecarsFound += 1;
            ratings += Number(candidate.xmp.rating !== undefined);
            keywords += candidate.xmp.tags.length;
            labels += Number(candidate.xmp.label !== undefined && candidate.xmp.label !== null);
            if (candidate.xmp.labelUnknown) {
              warnings.push({
                code: "label_unknown",
                id: result.photoId,
                message: `Unknown XMP label: ${candidate.xmp.labelUnknown}`,
              });
            }
          }
        }
        const done = index + 1;
        const elapsed = Math.max((performance.now() - startedAt) / 1000, 0.001);
        await emit?.({
          event: "progress",
          phase: "import",
          done,
          total: candidates.length,
          per_sec: done / elapsed,
          ...(done < candidates.length
            ? { eta_s: (candidates.length - done) / (done / elapsed) }
            : {}),
        });
      },
    );
    const providerSettings = await readProviderSettings(handle);
    const embedMode = await handle.query<{ value: string }>(
      "SELECT value #>> '{}' AS value FROM settings WHERE key = 'embed_mode'",
    );
    const autoEmbed = embedMode.rows[0]?.value === "auto";
    const embedModel = resolveModels(providerSettings.models).embed;
    const queued = autoEmbed
      ? Number(
          (
            await handle.query<{ count: string }>(
              `SELECT COUNT(*)::text AS count
               FROM photos p
               LEFT JOIN embeddings e ON e.photo_id = p.id AND e.model = $2
               WHERE p.id = ANY($1::uuid[]) AND e.photo_id IS NULL`,
              [ids, embedModel],
            )
          ).rows[0]?.count ?? 0,
        )
      : 0;
    const embeddingCost = estimateEmbeddingCost(embedModel, queued);
    if (queued > 0 && embeddingCost.warning) warnings.push(embeddingCost.warning);
    return {
      schema: 1,
      ok: true,
      data: {
        imported,
        already_present: alreadyPresent,
        skipped_unsupported: skippedUnsupported,
        ids,
        volume:
          ids.length === 0
            ? null
            : {
                uuid: parsed.flags.has("--copy") ? LIBRARY_VOLUME_UUID : rootVolume.uuid,
                mount: parsed.flags.has("--copy") ? handle.path : rootVolume.mount,
                online: true,
              },
        xmp_read: { sidecars_found: sidecarsFound, ratings, keywords, labels },
        previews: { embedded_extracted: embeddedExtracted, bytes: previewBytes },
        embeddings: {
          queued,
          est_usd: embeddingCost.usd,
          note: autoEmbed ? "queued for background embedding" : "manual embedding mode",
        },
        elapsed_s: (performance.now() - startedAt) / 1000,
      } satisfies ImportData,
      warnings,
    };
  } finally {
    await lease.release();
  }
}

interface PreparedCandidate {
  sourcePath: string;
  volume: VolumeLocation;
  probe: ImageProbe;
  identity: Awaited<ReturnType<typeof identifyFile>>;
  exif: Awaited<ReturnType<typeof readExif>>;
  orientation: number;
  dimensions: { w: number; h: number };
  preview: Buffer;
  xmp: ReadXmp | undefined;
}

export async function importGeneratedArtifact(options: {
  path: string;
  handle: LibraryHandle;
  cacheRoot: string;
  revision: (photoId: string) => Omit<CommitRevisionRequest, "photoId">;
}): Promise<{
  photoId: string;
  revision: CommitRevisionResult;
  previewWritten: boolean;
}> {
  const resolver = await generatedArtifactResolver(options.handle.path);
  const candidate = await prepareCandidate(options.path, resolver);
  if (!candidate) throw new Error("The canonical generated artifact is not importable");
  const imported = await commitCandidate({
    candidate,
    copy: false,
    handle: options.handle,
    resolver,
    cacheRoot: options.cacheRoot,
    libraryPath: options.handle.path,
    initialTags: ["generated"],
    revision: options.revision,
  });
  return {
    photoId: imported.photoId,
    revision: imported.revision!,
    previewWritten: imported.previewWritten,
  };
}

async function generatedArtifactResolver(libraryPath: string): Promise<VolumeResolver> {
  const libraryRoot = await realpath(libraryPath);
  const libraryResolver = createVolumeResolver(undefined, libraryRoot);
  return {
    locate: async (sourcePath) => {
      const source = await realpath(sourcePath);
      const relPath = relative(libraryRoot, source);
      if (relPath === ".." || relPath.startsWith(`..${sep}`) || isAbsolute(relPath)) {
        throw new Error("Generated artifacts must be published inside the library");
      }
      return {
        uuid: LIBRARY_VOLUME_UUID,
        label: "photoctl library",
        mount: libraryRoot,
        relPath,
        online: true,
      };
    },
    resolve: async (volumeUuid, relPath) => await libraryResolver.resolve(volumeUuid, relPath),
  };
}

async function prepareCandidate(
  sourcePath: string,
  resolver: VolumeResolver,
): Promise<PreparedCandidate | undefined> {
  const probe = await probeImage(sourcePath);
  if (!probe) return undefined;
  const [volume, identity, exif, xmp] = await Promise.all([
    locateSource(sourcePath, resolver),
    identifySource(sourcePath),
    inspectSource(sourcePath, probe),
    readXmpSidecar(sourcePath),
  ]);
  if (!volume.online) throw new PhotoctlError("file_offline", `Source is offline: ${sourcePath}`);
  const orientation = parseExifOrientation(exif.orientation);
  let preview: Buffer;
  try {
    preview =
      probe.preview.kind === "embedded-jpeg"
        ? await createEmbeddedPreviewJpeg(sourcePath, probe.preview.range, orientation)
        : await createDecodedPreviewJpeg(sourcePath);
  } catch (error) {
    throw sourceReadError(error, sourcePath);
  }
  return {
    sourcePath,
    volume,
    probe,
    identity,
    exif,
    orientation,
    dimensions: orientedDimensions(exif.dimensions, orientation),
    preview,
    xmp,
  };
}

async function commitCandidate(options: {
  candidate: PreparedCandidate;
  copy: boolean;
  handle: LibraryHandle;
  resolver: VolumeResolver;
  cacheRoot: string;
  libraryPath: string;
  initialTags?: string[];
  revision?: (photoId: string) => Omit<CommitRevisionRequest, "photoId">;
}): Promise<{
  photoId: string;
  alreadyPresent: boolean;
  previewWritten: boolean;
  revision?: CommitRevisionResult;
}> {
  const { candidate, handle, resolver, cacheRoot } = options;
  let copiedPath: string | undefined;
  let pinnedPath: string | undefined;
  let previousPreview: TrashReceipt | undefined;
  await handle.query("BEGIN");
  try {
    const resolved = await resolveContentIdentity(
      handle,
      candidate.sourcePath,
      candidate.identity,
      candidate.volume.uuid,
      candidate.volume.relPath,
      resolver,
    );
    const existing = await handle.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM photos WHERE id = $1) AS exists",
      [resolved.photoId],
    );
    const alreadyPresent = existing.rows[0]?.exists === true;
    if (alreadyPresent && options.revision) {
      throw new Error("The generated pixels already exist in this library");
    }
    const copied = options.copy
      ? await copyIntoLibrary(
          candidate.sourcePath,
          options.libraryPath,
          candidate.exif.shotAt,
          resolved.photoId,
          candidate.identity.contentKey,
          resolved.contentHash,
        )
      : undefined;
    copiedPath = copied?.created ? copied.path : undefined;
    const storedPath = copied?.path ?? candidate.sourcePath;
    const storedIdentity = options.copy ? await identifySource(storedPath) : candidate.identity;
    if (
      storedIdentity.contentKey !== candidate.identity.contentKey ||
      storedIdentity.size !== candidate.identity.size
    ) {
      throw sourceChangedError(candidate.sourcePath);
    }
    if (resolved.contentHash && (await fullFileHash(storedPath)) !== resolved.contentHash) {
      throw sourceChangedError(candidate.sourcePath);
    }
    const volume = options.copy
      ? {
          uuid: LIBRARY_VOLUME_UUID,
          label: "photoctl library",
          mount: options.libraryPath,
          relPath: relative(options.libraryPath, storedPath),
          online: true,
        }
      : candidate.volume;
    if (!alreadyPresent) {
      await handle.query(
        `INSERT INTO photos
           (id, content_key, content_hash, size, w, h, orientation, camera, exposure,
            shot_at, shot_offset_min)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)`,
        [
          resolved.photoId,
          candidate.identity.contentKey,
          resolved.contentHash,
          candidate.identity.size,
          candidate.dimensions.w,
          candidate.dimensions.h,
          candidate.orientation,
          JSON.stringify(candidate.exif.camera),
          JSON.stringify(candidate.exif.exposure),
          candidate.exif.shotAt?.toISOString() ?? null,
          candidate.exif.shotOffsetMin,
        ],
      );
    }
    await handle.query(
      `INSERT INTO volumes (uuid, label, last_mount, last_seen)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (uuid) DO UPDATE
       SET label = EXCLUDED.label, last_mount = EXCLUDED.last_mount, last_seen = EXCLUDED.last_seen`,
      [volume.uuid, volume.label, volume.mount],
    );
    await removeMissingLocators(handle, resolved.photoId, volume.uuid, volume.relPath, resolver);
    await handle.query(
      `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime, embedded)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (volume_uuid, rel_path) DO UPDATE
       SET photo_id = EXCLUDED.photo_id, mtime = EXCLUDED.mtime, embedded = EXCLUDED.embedded`,
      [
        newLibraryEntityId(),
        resolved.photoId,
        volume.uuid,
        volume.relPath,
        storedIdentity.mtime.toISOString(),
        JSON.stringify(candidate.probe.embedded),
      ],
    );
    const previewMatches = await pinnedPreviewMatches(
      cacheRoot,
      resolved.photoId,
      candidate.preview,
    );
    if (!previewMatches) {
      try {
        previousPreview = await stageFileRemoval(
          pinnedEmbeddedJpegPath(cacheRoot, resolved.photoId),
        );
        pinnedPath = (await pinPreviewBytes(cacheRoot, resolved.photoId, candidate.preview)).path;
      } catch {
        throw cacheWriteError(cacheRoot);
      }
    }
    await handle.query(
      `INSERT INTO cache_index (path, bytes, last_used, pinned)
       VALUES ($1, $2, now(), true)
       ON CONFLICT (path) DO UPDATE
       SET bytes = EXCLUDED.bytes, last_used = EXCLUDED.last_used, pinned = true`,
      [`emb/${resolved.photoId}.jpg`, candidate.preview.length],
    );
    if (candidate.xmp) {
      await applyImportedXmp(handle, resolved.photoId, candidate.xmp, !alreadyPresent);
    }
    if (options.initialTags?.length) {
      await handle.query(
        `INSERT INTO tags (photo_id, tag)
         SELECT $1, tag FROM unnest($2::text[]) AS tag
         ON CONFLICT DO NOTHING`,
        [resolved.photoId, options.initialTags],
      );
    }
    const revision = options.revision
      ? await commitRevisionInTransaction(handle, {
          photoId: resolved.photoId,
          ...options.revision(resolved.photoId),
        })
      : undefined;
    const after = await stat(storedPath);
    if (
      after.size !== storedIdentity.size ||
      after.mtime.getTime() !== storedIdentity.mtime.getTime()
    ) {
      throw sourceChangedError(candidate.sourcePath);
    }
    await handle.query("COMMIT");
    await previousPreview?.commit().catch(() => undefined);
    return { photoId: resolved.photoId, alreadyPresent, previewWritten: !previewMatches, revision };
  } catch (error) {
    await handle.query("ROLLBACK");
    if (copiedPath) await rm(copiedPath, { force: true });
    if (pinnedPath) await rm(pinnedPath, { force: true });
    await previousPreview?.rollback();
    throw error;
  }
}

async function removeMissingLocators(
  handle: LibraryHandle,
  photoId: string,
  currentVolume: string,
  currentPath: string,
  resolver: VolumeResolver,
): Promise<void> {
  const stored = await handle.query<{ id: string; volume_uuid: string; rel_path: string }>(
    `SELECT id::text, volume_uuid, rel_path FROM files
     WHERE photo_id = $1 AND NOT (volume_uuid = $2 AND rel_path = $3)`,
    [photoId, currentVolume, currentPath],
  );
  for (const locator of stored.rows) {
    const resolved = await resolver.resolve(locator.volume_uuid, locator.rel_path);
    if (!resolved.online && resolved.mount !== null) {
      await handle.query("DELETE FROM files WHERE id = $1", [locator.id]);
    }
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

export async function copyIntoLibrary(
  sourcePath: string,
  library: string,
  shotAt: Date | null,
  photoId: string,
  contentKey: string,
  contentHash: string | null,
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
      if (
        existing.contentKey !== contentKey ||
        (contentHash !== null && (await fullFileHash(destination)) !== contentHash)
      ) {
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
