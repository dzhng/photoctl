/* eslint-disable no-await-in-loop -- Source fallback order is semantic and bounds native decoder memory. */
import {
  PhotoctlError,
  type Envelope,
  type ErrorCode,
  type ExportResult,
  type Warning,
} from "@photoctl/protocol";
import { cacheRootForLibrary, formatShotInstant } from "@photoctl/importer";
import {
  createVolumeResolver,
  resolvePhotoId,
  type LibraryHandle,
  type VolumeResolver,
} from "@photoctl/library";
import {
  ensurePhotoDocument,
  evaluateGraphNode,
  exportImage,
  ExportPresetError,
  loadExportPreset,
  readArtifactImage,
  renderExportTemplate,
  resolveExportCollision,
  SourceEvaluationError,
  type DeliveryMetadata,
  type ExportCollisionPolicy,
  type ExportFormat,
  type ExportPreset,
} from "@photoctl/render";
import { mkdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { hasErrorCode } from "../errors.js";
import { parseExportArguments, type ExportOverrides } from "../export-arguments.js";
import {
  graphSourceWarning,
  resolveGraphSources,
  type GraphSourceCandidate,
} from "../graph-source.js";
import { loadPhoto, type StoredPhoto } from "../photo.js";
import { runSerially } from "../serial.js";

interface EffectiveExportOptions {
  to: string;
  format: ExportFormat;
  quality: number;
  resize?: number;
  template: string;
  onCollision: ExportCollisionPolicy;
  metadata: DeliveryMetadata;
}

interface ExportSnapshot {
  input: string;
  id: string;
  photo: StoredPhoto;
  outputNodeId: `node_${string}`;
  renderHash: `r_${string}`;
}

interface ExportFailure {
  id: string;
  ok: false;
  code: ErrorCode;
  [key: string]: unknown;
}

export async function exportCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseExportArguments(args);
  if (parsed.inputs.length === 0)
    throw new PhotoctlError("usage", "export requires at least one photo ID");

  const lease = await openRequestLibrary(env, cwd, provided);
  const { handle } = lease;
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
    const snapshots = await snapshotBatch(handle, parsed.inputs);
    const libraryId = await readLibraryId(handle);
    const resolver = createVolumeResolver(env.volumeMap, handle.path);
    const cacheRoot = cacheRootForLibrary(libraryId, cacheBase(env, cwd));
    const results: Array<ExportResult | ExportFailure> = [];
    const warnings: Warning[] = [];

    await runSerially(
      snapshots.map((snapshot, index) => ({ snapshot, sequence: index + 1 })),
      async ({ snapshot, sequence }) => {
        if ("failure" in snapshot) {
          results.push(snapshot.failure);
          return;
        }
        try {
          const exported = await exportOne(
            handle,
            resolver,
            snapshot,
            outputDirectory,
            cacheRoot,
            options,
            sequence,
            env,
          );
          warnings.push(...exported.warnings);
          results.push(exported.result);
        } catch (error) {
          if (error instanceof PhotoctlError) {
            results.push({
              id: snapshot.input,
              ok: false,
              code: error.code,
              ...errorData(error.data),
            });
            return;
          }
          throw error;
        }
      },
    );

    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      return {
        schema: 1,
        ok: false,
        code: aggregateFailureCode(failed, results.length),
        summary: { ok: results.length - failed.length, failed: failed.length },
        results,
        warnings,
      };
    }
    return { schema: 1, ok: true, summary: { ok: results.length, failed: 0 }, results, warnings };
  } finally {
    await lease.release();
  }
}

async function snapshotBatch(
  database: LibraryHandle,
  inputs: string[],
): Promise<Array<ExportSnapshot | { failure: ExportFailure }>> {
  return await Promise.all(
    inputs.map(async (input) => {
      try {
        const id = await resolvePhotoId(database, input);
        const photo = await loadPhoto(database, id);
        const renderState = await ensurePhotoDocument(database, {
          photoId: id,
          orientation: photo.orientation,
        });
        return {
          input,
          id,
          photo,
          outputNodeId: renderState.outputNodeId,
          renderHash: renderState.renderHash,
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
  const fallbackFile = snapshot.photo.files[0];
  if (!fallbackFile)
    throw new PhotoctlError("file_offline", `Photo has no source: ${snapshot.id}`, {
      id: snapshot.id,
    });
  const pinnedPath = join(cacheRoot, "emb", `${snapshot.id}.jpg`);
  const candidates = await resolveGraphSources({
    photo: snapshot.photo,
    resolver,
    pinned: {
      kind: "pinned-preview",
      path: pinnedPath,
      mediaType: "image/jpeg",
      orientation: 1,
    },
    pinnedLocator: { kind: "pinned-preview", cache_path: `emb/${snapshot.id}.jpg` },
    env,
  });
  const outputFile = candidates.find((candidate) => candidate.file)?.file ?? fallbackFile;
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
    throw new PhotoctlError("usage", error instanceof Error ? error.message : String(error));
  }
  const extension =
    options.format === "jpeg" ? ".jpg" : options.format === "tiff" ? ".tif" : ".png";
  const requestedPath = join(outputDirectory, `${name}${extension}`);
  let collision;
  try {
    collision = await resolveExportCollision(requestedPath, options.onCollision);
  } catch (error) {
    throw new PhotoctlError(
      "volume_readonly",
      error instanceof Error ? error.message : String(error),
      { path: requestedPath },
    );
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
        skipped: true,
      },
      warnings: [],
    };
  }

  try {
    const evaluated = await evaluateExportImage(handle, snapshot, candidates);
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
        skipped: false,
      },
      warnings: evaluated.warnings,
    };
  } catch (error) {
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
        volume: fallbackFile.volumeUuid,
        hint: `mount ${fallbackFile.lastMount}`,
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
  snapshot: ExportSnapshot,
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
    try {
      const warning = graphSourceWarning(snapshot.id, candidate.fallback);
      return {
        image: await evaluate(candidate),
        warnings: warning ? [warning] : [],
      };
    } catch (error) {
      if (!(error instanceof SourceEvaluationError)) {
        throw new PhotoctlError("decoder_unavailable", errorMessage(error), { id: snapshot.id });
      }
    }
  }
  throw new PhotoctlError(
    "file_offline",
    `No usable image source is available for ${snapshot.id}`,
    { id: snapshot.id },
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function aggregateFailureCode(failures: ExportFailure[], total: number): ErrorCode {
  if (failures.length < total) return "partial";
  const codes = new Set(failures.map((failure) => failure.code));
  return codes.size === 1 ? failures[0].code : "partial";
}

function errorData(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}
