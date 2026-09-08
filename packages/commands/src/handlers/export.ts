/* eslint-disable no-await-in-loop -- Source fallback order is semantic and bounds native decoder memory. */
import {
  PhotoctlError,
  type Envelope,
  type ExportResult,
  type StderrEvent,
  type Warning,
} from "@photoctl/protocol";
import { cacheRootForLibrary, formatShotInstant } from "@photoctl/importer";
import {
  createVolumeResolver,
  catalogPhotoAtDestination,
  resolvePhotoId,
  type LibraryHandle,
  type VolumeResolver,
} from "@photoctl/library";
import {
  activeLayerStatus,
  readCanvasStatus,
  ensurePhotoDocument,
  evaluateGraphNode,
  evaluateRetainedGraphNode,
  readRetainedGraphOutput,
  orientedDimensions,
  exportImage,
  ExportPresetError,
  loadExportPreset,
  loadActiveDocument,
  readArtifactImage,
  readActiveDevelopState,
  renderExportTemplate,
  resolveExportCollision,
  SourceEvaluationError,
  type DeliveryMetadata,
  type ExportCollisionPolicy,
  type ExportFormat,
  type ExportPreset,
  renderSource,
} from "@photoctl/render";
import { mkdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { batchEnvelope, errorData, type BatchFailure } from "../batch.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { errorMessage, hasErrorCode } from "../errors.js";
import { parseExportArguments, type ExportOverrides } from "../export-arguments.js";
import {
  graphSourceWarning,
  resolveGraphSources,
  type GraphSourceCandidate,
} from "../graph-source.js";
import { loadPhoto, type StoredPhoto } from "../photo.js";
import { createProgressHeartbeat } from "../progress.js";
import { cameraJpegRendition } from "../original-rendition.js";
import { resolveOnlineOriginalSource } from "../image-source.js";

interface EffectiveExportOptions {
  to: string;
  format: ExportFormat;
  quality: number;
  resize?: number;
  template: string;
  onCollision: ExportCollisionPolicy;
  metadata: DeliveryMetadata;
}

interface ExportSnapshotBase {
  input: string;
  id: string;
  photo: StoredPhoto;
  renderHash: `r_${string}`;
  warnings: Warning[];
}
type ExportSnapshot = ExportSnapshotBase &
  ({ source: "document"; outputNodeId: `node_${string}` } | { source: "camera-jpeg" });

export async function exportCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  emit?: (event: StderrEvent) => void | Promise<void>,
): Promise<Envelope> {
  const parsed = parseExportArguments(args);
  if (parsed.inputs.length === 0)
    throw new PhotoctlError("usage", "export requires at least one photo ID");

  const lease = await openRequestLibrary(env, cwd, provided);
  const { handle } = lease;
  const progress = createProgressHeartbeat({
    emit:
      emit &&
      (async (event) => {
        try {
          await emit(event);
        } catch {
          // Progress is advisory; a broken side channel must not abort file delivery.
        }
      }),
    phase: "export",
    total: parsed.inputs.length,
  });
  try {
    const options = await effectiveOptions(parsed.overrides, handle.path, cwd);
    const outputDirectory = resolve(cwd, options.to);
    try {
      await mkdir(outputDirectory, { recursive: true });
    } catch {
      throw new PhotoctlError("volume_readonly", "Cannot create export destination", {
        path: outputDirectory,
      });
    }
    await progress.start();
    const snapshots = await snapshotBatch(handle, parsed.inputs, parsed.overrides.source);
    const libraryId = await readLibraryId(handle);
    const resolver = createVolumeResolver(env.volumeMap, handle.path);
    const cacheRoot = cacheRootForLibrary(libraryId, cacheBase(env, cwd));
    const results: Array<ExportResult | BatchFailure> = [];
    const warnings: Warning[] = [];

    for (const [index, snapshot] of snapshots.entries()) {
      if ("failure" in snapshot) {
        results.push(snapshot.failure);
        await progress.advance(1);
        continue;
      }
      warnings.push(...snapshot.warnings);
      try {
        const exported = await exportOne(
          handle,
          resolver,
          snapshot,
          outputDirectory,
          cacheRoot,
          options,
          index + 1,
          env,
        );
        warnings.push(...exported.warnings);
        results.push(exported.result);
      } catch (error) {
        if (!(error instanceof PhotoctlError)) throw error;
        const sourceFile = snapshot.photo.originals.find(
          (original) => original.id === snapshot.photo.primaryOriginalId,
        )?.files[0];
        results.push({
          id: snapshot.input,
          ok: false,
          code: error.code,
          ...(error.code === "file_offline" && sourceFile
            ? { volume: sourceFile.volumeUuid, hint: `mount ${sourceFile.lastMount}` }
            : {}),
          ...errorData(error.data),
        });
      } finally {
        await progress.advance(1);
      }
    }
    return batchEnvelope(results, warnings);
  } finally {
    try {
      await progress.stop();
    } finally {
      await lease.release();
    }
  }
}

async function snapshotBatch(
  database: LibraryHandle,
  inputs: string[],
  source?: "camera-jpeg",
): Promise<Array<ExportSnapshot | { failure: BatchFailure }>> {
  return await Promise.all(
    inputs.map(async (input) => {
      try {
        const id = await resolvePhotoId(database, input);
        const photo = await loadPhoto(database, id);
        if (source) {
          const rendition = cameraJpegRendition(photo);
          return {
            input,
            id,
            photo: rendition.photo,
            renderHash: rendition.renderHash,
            warnings: [],
            source,
          };
        }
        await ensurePhotoDocument(database, {
          photoId: id,
          orientation: photo.orientation,
        });
        const document = await loadActiveDocument(database, id);
        if (!document) throw new Error("The active photo document is missing");
        const layerStatus =
          document.layers.length > 0
            ? await activeLayerStatus(
                database,
                await readActiveDevelopState(database, {
                  photoId: id,
                  orientation: photo.orientation,
                }),
              )
            : { staleIds: [], unfilledVacancyIds: [] };
        return {
          source: "document" as const,
          input,
          id,
          photo,
          outputNodeId: document.roots.output as `node_${string}`,
          renderHash: document.renderHash,
          warnings: [
            ...((await readCanvasStatus(database, id, document.roots.output)).uncovered
              ? [
                  {
                    code: "canvas_uncovered" as const,
                    id,
                    message: "The viewport includes unsupported canvas coordinates",
                  },
                ]
              : []),
            ...(layerStatus.staleIds.length > 0
              ? [
                  {
                    code: "layers_stale" as const,
                    id,
                    message: `${layerStatus.staleIds.length} ${layerStatus.staleIds.length === 1 ? "layer is" : "layers are"} stale`,
                  },
                ]
              : []),
            ...(layerStatus.unfilledVacancyIds.length > 0
              ? [
                  {
                    code: "vacancy_unfilled" as const,
                    id,
                    message: `${layerStatus.unfilledVacancyIds.length} ${layerStatus.unfilledVacancyIds.length === 1 ? "vacancy is" : "vacancies are"} unfilled`,
                  },
                ]
              : []),
          ],
        };
      } catch (error) {
        if (error instanceof PhotoctlError) {
          return { failure: { id: input, ok: false, code: error.code, ...errorData(error.data) } };
        }
        throw error;
      }
    }),
  );
}

async function exportOne(
  handle: LibraryHandle,
  resolver: VolumeResolver,
  snapshot: ExportSnapshot,
  outputDirectory: string,
  cacheRoot: string,
  options: EffectiveExportOptions,
  sequence: number,
  env: RequestEnv,
): Promise<{ result: ExportResult; warnings: Warning[] }> {
  const fallbackFile = snapshot.photo.originals.find(
    (original) => original.id === snapshot.photo.primaryOriginalId,
  )?.files[0];
  if (!fallbackFile)
    throw new PhotoctlError("file_offline", `Photo has no source: ${snapshot.id}`, {
      id: snapshot.id,
    });
  let outputFile = fallbackFile;
  let evaluate: () => ReturnType<typeof evaluateExportImage>;
  if (snapshot.source === "camera-jpeg") {
    const camera = await resolveOnlineOriginalSource(snapshot.photo, resolver);
    if (!camera)
      throw new PhotoctlError("file_offline", "Camera JPEG original is unavailable", {
        id: snapshot.id,
      });
    outputFile = camera.file;
    evaluate = async () => ({
      image: await renderSource(snapshot.photo.orientation, camera.source),
      warnings: [],
    });
  } else {
    const candidates = await resolveGraphSources({
      photo: snapshot.photo,
      resolver,
      cacheRoot,
      env,
    });
    outputFile = candidates.find((candidate) => candidate.file)?.file ?? fallbackFile;
    evaluate = () => evaluateExportImage(handle, snapshot, candidates);
  }
  const stem = basename(outputFile.relPath, extname(outputFile.relPath));
  let name: string;
  try {
    name = renderExportTemplate(options.template, {
      date:
        snapshot.photo.shotAt && snapshot.photo.shotOffsetMin !== null
          ? formatShotInstant(new Date(snapshot.photo.shotAt), snapshot.photo.shotOffsetMin)
          : null,
      sequence,
      stem,
      id: snapshot.id,
      rating: snapshot.photo.rating,
    });
  } catch (error) {
    throw new PhotoctlError("usage", errorMessage(error));
  }
  const extension =
    options.format === "jpeg" ? ".jpg" : options.format === "tiff" ? ".tif" : ".png";
  const requestedPath = join(outputDirectory, `${name}${extension}`);
  let collision;
  try {
    collision = await resolveExportCollision(requestedPath, options.onCollision);
  } catch (error) {
    throw new PhotoctlError("volume_readonly", errorMessage(error), { path: requestedPath });
  }
  if (collision.action === "skip") {
    let existing;
    try {
      existing = await inspectExisting(collision.path);
    } catch {
      throw new PhotoctlError(
        "volume_readonly",
        `Existing export is not a readable image: ${collision.path}`,
        { id: snapshot.id, path: collision.path },
      );
    }
    return {
      result: {
        id: snapshot.id,
        ok: true,
        file: collision.path,
        w: existing.w,
        h: existing.h,
        bytes: existing.bytes,
        render_hash: snapshot.renderHash,
        source_original_id: snapshot.photo.primaryOriginalId,
        skipped: true,
      },
      warnings: [],
    };
  }

  try {
    const protectOriginal = async () => {
      if (options.onCollision !== "overwrite") return;
      try {
        if (!(await catalogPhotoAtDestination(handle, collision.path, resolver, handle.path)))
          return;
      } catch {
        throw new PhotoctlError("volume_readonly", "Could not verify export destination safety", {
          path: collision.path,
        });
      }
      throw new PhotoctlError("volume_readonly", "Export cannot replace a catalog original", {
        path: collision.path,
      });
    };
    await protectOriginal();
    const evaluated = await evaluate();
    // Rendering may be slow; recheck ownership before replacing a destination.
    await protectOriginal();
    const exported = await exportImage({
      id: snapshot.id,
      image: evaluated.image,
      outputPath: collision.path,
      format: options.format,
      quality: options.quality,
      resize: options.resize,
      metadata: options.metadata,
      replace: options.onCollision === "overwrite",
    });
    await handle.query(
      `INSERT INTO exports (photo_id, path, render_hash, bytes) VALUES ($1, $2, $3, $4)`,
      [snapshot.id, exported.file, snapshot.renderHash, exported.bytes],
    );
    return {
      result: {
        id: snapshot.id,
        ok: true,
        ...exported,
        render_hash: snapshot.renderHash,
        source_original_id: snapshot.photo.primaryOriginalId,
        skipped: false,
      },
      warnings: evaluated.warnings,
    };
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    if (hasErrorCode(error, "decoder_unavailable"))
      throw new PhotoctlError("decoder_unavailable", error.message, { id: snapshot.id });
    if (hasErrorCode(error, "volume_readonly")) {
      throw new PhotoctlError("volume_readonly", error.message, {
        id: snapshot.id,
        path: collision.path,
      });
    }
    if (hasErrorCode(error, "file_offline")) {
      throw new PhotoctlError("file_offline", error.message, {
        id: snapshot.id,
      });
    }
    throw error;
  }
}

async function inspectExisting(path: string): Promise<{ w: number; h: number; bytes: number }> {
  const [{ default: sharp }, file] = await Promise.all([import("sharp"), stat(path)]);
  const image = sharp(path);
  const [metadata] = await Promise.all([image.metadata(), image.clone().stats()]);
  if (!metadata.width || !metadata.height || file.size <= 0) {
    throw new PhotoctlError("volume_readonly", `Existing export is not a readable image: ${path}`, {
      path,
    });
  }
  return { w: metadata.width, h: metadata.height, bytes: file.size };
}

async function evaluateExportImage(
  handle: LibraryHandle,
  snapshot: Extract<ExportSnapshot, { source: "document" }>,
  candidates: GraphSourceCandidate[],
): Promise<{
  image: Awaited<ReturnType<typeof readArtifactImage>>;
  warnings: Warning[];
}> {
  const evaluate = async (candidate: GraphSourceCandidate) => {
    const evaluated = await evaluateGraphNode({
      database: handle,
      libraryPath: handle.path,
      photoId: snapshot.id,
      nodeId: snapshot.outputNodeId,
      source: candidate.produce,
      developBaseDimensions: { w: snapshot.photo.w, h: snapshot.photo.h },
    });
    return await readArtifactImage(evaluated.artifact.path, evaluated.artifact.artifactHash);
  };

  for (const candidate of candidates) {
    if (candidate.fallback) {
      const dimensions =
        candidate.source.kind === "pinned-preview"
          ? await import("sharp").then(async ({ default: sharp }) => {
              try {
                const metadata = await sharp(candidate.source.path).metadata();
                return metadata.width && metadata.height
                  ? orientedDimensions(
                      { w: metadata.width, h: metadata.height },
                      candidate.source.orientation ?? 1,
                    )
                  : undefined;
              } catch {
                return undefined;
              }
            })
          : orientedDimensions(candidate.source, candidate.source.orientation ?? 1);
      const retained = await readRetainedGraphOutput({
        database: handle,
        libraryPath: handle.path,
        photoId: snapshot.id,
        nodeId: snapshot.outputNodeId,
        minimumSource: dimensions ? { dimensions, tier: candidate.source.kind } : undefined,
      });
      if (retained)
        return {
          image: await readArtifactImage(retained.artifact.path, retained.artifact.artifactHash),
          warnings: [
            {
              code: candidate.fallback,
              id: snapshot.id,
              message: "Used a retained current render because the original source is unavailable",
            },
          ],
        };
    }
    try {
      const warning = graphSourceWarning(snapshot.id, candidate.fallback);
      return {
        image: await evaluate(candidate),
        warnings: warning ? [warning] : [],
      };
    } catch (error) {
      if (error instanceof PhotoctlError) throw error;
      if (!(error instanceof SourceEvaluationError)) {
        throw new PhotoctlError("decoder_unavailable", errorMessage(error), { id: snapshot.id });
      }
    }
  }
  try {
    const retained = await evaluateRetainedGraphNode({
      database: handle,
      libraryPath: handle.path,
      photoId: snapshot.id,
      nodeId: snapshot.outputNodeId,
    });
    return {
      image: await readArtifactImage(retained.artifact.path, retained.artifact.artifactHash),
      warnings: [
        {
          code: "source_offline",
          id: snapshot.id,
          message: "Used retained graph pixels because no image source could be decoded",
        },
      ],
    };
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    if (!(error instanceof SourceEvaluationError))
      throw new PhotoctlError("decoder_unavailable", errorMessage(error), { id: snapshot.id });
  }
  throw new PhotoctlError(
    "file_offline",
    `No usable image source is available for ${snapshot.id}`,
    { id: snapshot.id },
  );
}

async function effectiveOptions(
  overrides: ExportOverrides,
  libraryPath: string,
  cwd: string,
): Promise<EffectiveExportOptions> {
  let preset: ExportPreset = {};
  try {
    preset = overrides.preset ? await loadExportPreset(overrides.preset, libraryPath) : {};
  } catch (error) {
    if (error instanceof ExportPresetError) {
      throw new PhotoctlError(error.reason === "not_found" ? "not_found" : "usage", error.message, {
        preset: overrides.preset,
      });
    }
    throw error;
  }
  const merged: ExportOverrides = {
    ...preset,
    ...overrides,
    metadata: { ...preset.metadata, ...overrides.metadata },
  };
  if (!merged.to) throw new PhotoctlError("usage", "export requires --to");
  return {
    to: resolve(cwd, merged.to),
    format: merged.format ?? "jpeg",
    quality: merged.quality ?? 88,
    resize: merged.resize,
    template: merged.template ?? "{stem}",
    onCollision: merged.onCollision ?? "rename",
    metadata: merged.metadata ?? {},
  };
}
