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
  preparePinnedPreviewCache,
  probeImage,
  readExif,
  scanCandidates,
  planImportSources,
  type CompanionMode,
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
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
  const commandStartedAt = performance.now();
  const parsed = parseArguments(args, {
    flags: ["--link", "--copy", "--recursive"],
    options: ["--companions"],
  });
  const companions = parsed.options.get("--companions") ?? "paired";
  if (!["paired", "raw", "jpeg", "both"].includes(companions)) {
    throw new PhotoctlError("usage", "--companions requires paired, raw, jpeg or both");
  }
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
  await emit?.({ event: "progress", phase: "inspect", done: 0, total: candidates.length });
  const inspectionStartedAt = performance.now();
  const units = await planImportSources(candidates, companions as CompanionMode, async (done) => {
    const elapsed = Math.max((performance.now() - inspectionStartedAt) / 1000, 0.001);
    await emit?.({
      event: "progress",
      phase: "inspect",
      done,
      total: candidates.length,
      per_sec: done / elapsed,
      ...(done < candidates.length ? { eta_s: ((candidates.length - done) * elapsed) / done } : {}),
    });
  });
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
  const conflicts: ImportData["conflicts"] = [];
  let sidecarsFound = 0;
  let ratings = 0;
  let keywords = 0;
  let labels = 0;
  let embeddedExtracted = 0;
  let previewBytes = 0;
  const startedAt = performance.now();
  try {
    if (units.some((unit) => !unit.conflict && unit.sources.some((source) => source.probe))) {
      try {
        await preparePinnedPreviewCache(cacheRoot);
      } catch {
        throw cacheWriteError(cacheRoot);
      }
    }
    await consumeBoundedOrdered(
      units,
      IMPORT_CONCURRENCY,
      async (unit) => {
        try {
          return unit.conflict
            ? []
            : await Promise.all(
                unit.sources.map(async (source) =>
                  source.probe
                    ? await prepareCandidate(source.path, externalResolver, source.probe)
                    : undefined,
                ),
              );
        } catch (error) {
          if (!(error instanceof PhotoctlError)) throw error;
          return error;
        }
      },
      async (preparation, index) => {
        const prepared = preparation instanceof PhotoctlError ? [] : preparation;
        const candidate = prepared[0];
        const unit = units[index];
        const conflict = preparation instanceof PhotoctlError ? preparation.message : unit.conflict;
        if (conflict) {
          conflicts.push({
            paths: unit.sources.map((source) => source.path),
            reason: conflict,
          });
        } else if (!candidate) {
          skippedUnsupported += 1;
        } else {
          let result;
          try {
            result = await commitCandidate({
              candidate,
              companions: prepared
                .slice(1)
                .filter((item): item is PreparedCandidate => item !== undefined),
              separate: companions === "both",
              copy: parsed.flags.has("--copy"),
              handle,
              resolver,
              cacheRoot,
              libraryPath: handle.path,
            });
          } catch (error) {
            if (!(error instanceof PhotoctlError)) throw error;
            conflicts.push({
              paths: unit.sources.map((source) => source.path),
              reason: error.message,
            });
          }
          if (result) {
            if (!ids.includes(result.photoId)) {
              ids.push(result.photoId);
              imported += Number(!result.alreadyPresent);
              alreadyPresent += Number(result.alreadyPresent);
            }
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
        }
        const done = index + 1;
        const elapsed = Math.max((performance.now() - startedAt) / 1000, 0.001);
        await emit?.({
          event: "progress",
          phase: "import",
          done,
          total: units.length,
          per_sec: done / elapsed,
          ...(done < units.length ? { eta_s: (units.length - done) / (done / elapsed) } : {}),
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
      ...(conflicts.length > 0
        ? { ok: false as const, code: "partial" as const }
        : { ok: true as const }),
      data: {
        imported,
        already_present: alreadyPresent,
        skipped_unsupported: skippedUnsupported,
        skipped_conflicts: conflicts.length,
        conflicts,
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
        elapsed_s: (performance.now() - commandStartedAt) / 1000,
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
  revision: (photoId: string) => Omit<CommitRevisionRequest, "photoId" | "outputPlan">;
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
  detected?: ImageProbe,
): Promise<PreparedCandidate | undefined> {
  const probe = detected ?? (await probeImage(sourcePath));
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
  companions?: PreparedCandidate[];
  separate?: boolean;
  copy: boolean;
  handle: LibraryHandle;
  resolver: VolumeResolver;
  cacheRoot: string;
  libraryPath: string;
  initialTags?: string[];
  revision?: (photoId: string) => Omit<CommitRevisionRequest, "photoId" | "outputPlan">;
}): Promise<{
  photoId: string;
  alreadyPresent: boolean;
  previewWritten: boolean;
  revision?: CommitRevisionResult;
}> {
  const { candidate, handle, resolver, cacheRoot } = options;
  const members = [candidate, ...(options.companions ?? [])];
  for (const companion of members.slice(1)) {
    const left = candidate.exif;
    const right = companion.exif;
    const conflicts = (
      a: string | number | null | undefined,
      b: string | number | null | undefined,
    ) => a != null && b != null && a !== b;
    if (
      conflicts(left.shotAt?.getTime(), right.shotAt?.getTime()) ||
      conflicts(left.camera.make, right.camera.make) ||
      conflicts(left.camera.model, right.camera.model)
    ) {
      throw new PhotoctlError("usage", "Same-stem originals have contradictory capture metadata", {
        paths: members.map((member) => member.sourcePath),
      });
    }
  }
  const copiedPaths: string[] = [];
  let pinnedPath: string | undefined;
  let previousPreview: TrashReceipt | undefined;
  await handle.query("BEGIN");
  try {
    const identified = [];
    for (const member of members) {
      const identity = await resolveContentIdentity(
        handle,
        member.sourcePath,
        member.identity,
        member.volume.uuid,
        member.volume.relPath,
        resolver,
      );
      const stored = await handle.query<{ photo_id: string }>(
        "SELECT photo_id::text FROM originals WHERE id = $1",
        [identity.originalId],
      );
      identified.push({ member, identity, owner: stored.rows[0]?.photo_id });
    }
    const owners = new Set(identified.flatMap((entry) => (entry.owner ? [entry.owner] : [])));
    if (owners.size > 1) {
      throw new PhotoctlError(
        "usage",
        "Companions already belong to different photos; import cannot merge their edit histories",
      );
    }
    const photoId = [...owners][0] ?? newLibraryEntityId();
    const alreadyPresent = owners.size > 0;
    if (alreadyPresent && options.separate) {
      const others = await handle.query<{ present: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM originals WHERE photo_id = $1 AND id <> $2) AS present",
        [photoId, identified[0].identity.originalId],
      );
      if (others.rows[0]?.present)
        throw new PhotoctlError("usage", "Import cannot split an existing paired photo");
    }
    if (alreadyPresent && options.revision)
      throw new Error("The generated pixels already exist in this library");
    if (alreadyPresent) {
      const existingKinds = await handle.query<{ id: string; kind: string }>(
        "SELECT id::text, kind FROM originals WHERE photo_id = $1",
        [photoId],
      );
      for (const { member, identity } of identified) {
        if (
          existingKinds.rows.some(
            (existing) =>
              existing.kind === originalKind(member.probe) && existing.id !== identity.originalId,
          )
        ) {
          throw new PhotoctlError(
            "usage",
            "The photo already owns a different original of this kind; import cannot replace or add another companion",
          );
        }
      }
    }
    if (alreadyPresent && members.length > 1) {
      const primary = await handle.query<{ primary_original_id: string }>(
        "SELECT primary_original_id::text FROM photos WHERE id = $1",
        [photoId],
      );
      if (primary.rows[0]?.primary_original_id !== identified[0].identity.originalId) {
        throw new PhotoctlError(
          "usage",
          "Pairing would change an existing photo's primary source; import cannot rewrite its edits",
        );
      }
    }
    if (!alreadyPresent) {
      await handle.query(
        "INSERT INTO photos (id, primary_original_id, w, h, orientation) VALUES ($1, $2, $3, $4, $5)",
        [
          photoId,
          identified[0].identity.originalId,
          candidate.dimensions.w,
          candidate.dimensions.h,
          candidate.orientation,
        ],
      );
    }
    for (const { member, identity, owner } of identified) {
      const copied = options.copy
        ? await copyIntoLibrary(
            member.sourcePath,
            options.libraryPath,
            member.exif.shotAt,
            identity.originalId,
            member.identity.contentKey,
            identity.contentHash,
          )
        : undefined;
      if (copied?.created) copiedPaths.push(copied.path);
      const storedPath = copied?.path ?? member.sourcePath;
      const storedIdentity = options.copy ? await identifySource(storedPath) : member.identity;
      if (
        storedIdentity.contentKey !== member.identity.contentKey ||
        storedIdentity.size !== member.identity.size
      ) {
        throw sourceChangedError(member.sourcePath);
      }
      if (identity.contentHash && (await fullFileHash(storedPath)) !== identity.contentHash) {
        throw sourceChangedError(member.sourcePath);
      }
      const volume = options.copy
        ? {
            uuid: LIBRARY_VOLUME_UUID,
            label: "photoctl library",
            mount: options.libraryPath,
            relPath: relative(options.libraryPath, storedPath),
            online: true,
          }
        : member.volume;
      const occupied = await handle.query<{ original_id: string }>(
        "SELECT original_id::text FROM files WHERE volume_uuid = $1 AND rel_path = $2",
        [volume.uuid, volume.relPath],
      );
      if (occupied.rows[0] && occupied.rows[0].original_id !== identity.originalId) {
        throw new PhotoctlError(
          "usage",
          "The imported path now contains a different original; import cannot reassign its existing owner",
          {
            path: storedPath,
          },
        );
      }
      if (!owner) {
        await handle.query(
          `INSERT INTO originals
           (id, photo_id, kind, content_key, content_hash, size, w, h, orientation, camera, exposure, shot_at, shot_offset_min)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13)`,
          [
            identity.originalId,
            photoId,
            originalKind(member.probe),
            member.identity.contentKey,
            identity.contentHash,
            member.identity.size,
            member.exif.dimensions.w,
            member.exif.dimensions.h,
            member.orientation,
            JSON.stringify(member.exif.camera),
            JSON.stringify(member.exif.exposure),
            member.exif.shotAt?.toISOString() ?? null,
            member.exif.shotOffsetMin,
          ],
        );
      }
      await handle.query(
        `INSERT INTO volumes (uuid, label, last_mount, last_seen) VALUES ($1, $2, $3, now())
         ON CONFLICT (uuid) DO UPDATE SET label = EXCLUDED.label, last_mount = EXCLUDED.last_mount, last_seen = EXCLUDED.last_seen`,
        [volume.uuid, volume.label, volume.mount],
      );
      await removeMissingLocators(
        handle,
        identity.originalId,
        volume.uuid,
        volume.relPath,
        resolver,
      );
      await handle.query(
        `INSERT INTO files (id, original_id, volume_uuid, rel_path, mtime, embedded)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (volume_uuid, rel_path) DO UPDATE SET
           mtime = EXCLUDED.mtime, embedded = EXCLUDED.embedded`,
        [
          newLibraryEntityId(),
          identity.originalId,
          volume.uuid,
          volume.relPath,
          storedIdentity.mtime.toISOString(),
          JSON.stringify(member.probe.embedded),
        ],
      );
      const after = await stat(storedPath);
      if (
        after.size !== storedIdentity.size ||
        after.mtime.getTime() !== storedIdentity.mtime.getTime()
      ) {
        throw sourceChangedError(member.sourcePath);
      }
    }
    // Only the primary original owns the RAW-led document's pinned fallback.
    const primary = await handle.query<{ primary_original_id: string }>(
      "SELECT primary_original_id::text FROM photos WHERE id = $1",
      [photoId],
    );
    const isPrimary = primary.rows[0]?.primary_original_id === identified[0].identity.originalId;
    const previewMatches =
      !isPrimary || (await pinnedPreviewMatches(cacheRoot, photoId, candidate.preview));
    if (!previewMatches) {
      try {
        previousPreview = await stageFileRemoval(pinnedEmbeddedJpegPath(cacheRoot, photoId));
        pinnedPath = (await pinPreviewBytes(cacheRoot, photoId, candidate.preview)).path;
      } catch {
        throw cacheWriteError(cacheRoot);
      }
    }
    if (isPrimary) {
      await handle.query(
        `INSERT INTO cache_index (path, bytes, last_used, pinned) VALUES ($1, $2, now(), true)
         ON CONFLICT (path) DO UPDATE SET bytes = EXCLUDED.bytes, last_used = EXCLUDED.last_used, pinned = true`,
        [`emb/${photoId}.jpg`, candidate.preview.length],
      );
    }
    if (candidate.xmp && isPrimary)
      await applyImportedXmp(handle, photoId, candidate.xmp, !alreadyPresent);
    if (options.initialTags?.length)
      await handle.query(
        "INSERT INTO tags (photo_id, tag) SELECT $1, tag FROM unnest($2::text[]) AS tag ON CONFLICT DO NOTHING",
        [photoId, options.initialTags],
      );
    const revision = options.revision
      ? await commitRevisionInTransaction(handle, {
          photoId,
          ...options.revision(photoId),
        })
      : undefined;
    await handle.query("COMMIT");
    await previousPreview?.commit().catch(() => undefined);
    return { photoId, alreadyPresent, previewWritten: !previewMatches, revision };
  } catch (error) {
    await handle.query("ROLLBACK");
    for (const path of copiedPaths) await rm(path, { force: true });
    if (pinnedPath) await rm(pinnedPath, { force: true });
    await previousPreview?.rollback();
    throw error;
  }
}

function originalKind(probe: ImageProbe): "raw" | "jpeg" | "image" {
  return probe.kind === "raw" ? "raw" : probe.mediaType === "image/jpeg" ? "jpeg" : "image";
}

async function removeMissingLocators(
  handle: LibraryHandle,
  originalId: string,
  currentVolume: string,
  currentPath: string,
  resolver: VolumeResolver,
): Promise<void> {
  const stored = await handle.query<{ id: string; volume_uuid: string; rel_path: string }>(
    `SELECT id::text, volume_uuid, rel_path FROM files
     WHERE original_id = $1 AND NOT (volume_uuid = $2 AND rel_path = $3)`,
    [originalId, currentVolume, currentPath],
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
  originalId: string,
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
    if ((await realpath(directory)) === (await realpath(dirname(sourcePath)))) {
      return { path: preferred, created: false };
    }
    const destination = (await pathExists(preferred))
      ? join(directory, `${stem}_${originalId.replaceAll("-", "").slice(-8)}${extension}`)
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
