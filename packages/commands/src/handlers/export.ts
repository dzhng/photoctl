import {
  PhotoctlError,
  type Envelope,
  type ErrorCode,
  type ExportResult,
  type Warning,
} from "@photoctl/protocol";
import { cacheRootForLibrary } from "@photoctl/importer";
import {
  createVolumeResolver,
  resolvePhotoId,
  type LibraryHandle,
  type VolumeResolver,
} from "@photoctl/library";
import { exportImageAsJpeg, sourceRenderHash } from "@photoctl/render";
import { mkdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { hasErrorCode } from "../errors.js";
import { resolveOnlineImageSource } from "../image-source.js";
import { loadPhoto } from "../photo.js";
import { runSerially } from "../serial.js";

export async function exportCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, { options: ["--to", "--format"] });
  if (parsed.positionals.length === 0) {
    throw new PhotoctlError("usage", "export requires at least one photo ID");
  }
  const outputDirectory = parsed.options.get("--to");
  if (!outputDirectory) throw new PhotoctlError("usage", "export requires --to");
  const format = parsed.options.get("--format") ?? "jpeg";
  if (format !== "jpeg") {
    throw new PhotoctlError("unsupported_file", `Unsupported export format: ${format}`);
  }
  const resolvedOutputDirectory = resolve(cwd, outputDirectory);
  try {
    await mkdir(resolvedOutputDirectory, { recursive: true });
  } catch {
    throw new PhotoctlError("volume_readonly", `Cannot create export destination`, {
      path: resolvedOutputDirectory,
    });
  }

  const lease = await openRequestLibrary(env, cwd, provided);
  const { handle } = lease;
  try {
    const libraryId = await readLibraryId(handle);
    const resolver = createVolumeResolver(env.volumeMap, handle.path);
    const results: Array<ExportResult | ExportFailure> = [];
    const warnings: Warning[] = [];
    await runSerially(parsed.positionals, async (input) => {
      try {
        // Keep result and write order deterministic; output names may collide across inputs.
        const exported = await exportOne(
          handle,
          resolver,
          input,
          resolvedOutputDirectory,
          cacheRootForLibrary(libraryId, cacheBase(env, cwd)),
        );
        warnings.push(...exported.warnings);
        results.push(exported.result);
      } catch (error) {
        if (error instanceof PhotoctlError) {
          results.push({ id: input, ok: false, code: error.code, ...errorData(error.data) });
          return;
        }
        throw error;
      }
    });
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
    return {
      schema: 1,
      ok: true,
      summary: { ok: results.length, failed: 0 },
      results,
      warnings,
    };
  } finally {
    await lease.release();
  }
}

function aggregateFailureCode(failures: ExportFailure[], total: number): ErrorCode {
  if (failures.length < total) return "partial";
  const codes = new Set(failures.map((failure) => failure.code));
  return codes.size === 1 ? failures[0].code : "partial";
}

interface ExportFailure {
  id: string;
  ok: false;
  code: ErrorCode;
  [key: string]: unknown;
}

async function exportOne(
  handle: LibraryHandle,
  resolver: VolumeResolver,
  input: string,
  outputDirectory: string,
  cacheRoot: string,
): Promise<{ result: ExportResult; warnings: Warning[] }> {
  const id = await resolvePhotoId(handle, input);
  const photo = await loadPhoto(handle, id);
  const fallbackFile = photo.files[0];
  if (!fallbackFile) throw new PhotoctlError("file_offline", `Photo has no source: ${id}`, { id });
  const selected = await resolveOnlineImageSource(photo, resolver);
  const outputFile = selected?.file ?? fallbackFile;
  const outputPath = join(
    outputDirectory,
    `${basename(outputFile.relPath, extname(outputFile.relPath))}.jpg`,
  );
  try {
    const exported = await exportImageAsJpeg({
      id,
      orientation: photo.orientation,
      outputPath,
      sources: [
        ...(selected ? [selected.source] : []),
        {
          kind: "pinned-preview",
          path: join(cacheRoot, "emb", `${id}.jpg`),
          mediaType: "image/jpeg",
          orientation: 1,
        },
      ],
    });
    const { warnings, ...data } = exported;
    return {
      result: {
        id,
        ok: true,
        ...data,
        render_hash: sourceRenderHash({
          orientation: photo.orientation,
        }),
      },
      warnings,
    };
  } catch (error) {
    if (hasErrorCode(error, "unsupported_file")) {
      throw new PhotoctlError("unsupported_file", error.message, { id });
    }
    if (hasErrorCode(error, "decoder_unavailable")) {
      throw new PhotoctlError("decoder_unavailable", error.message, { id });
    }
    if (hasErrorCode(error, "volume_readonly")) {
      throw new PhotoctlError("volume_readonly", error.message, { id, path: outputPath });
    }
    if (hasErrorCode(error, "file_offline")) {
      throw new PhotoctlError("file_offline", error.message, {
        id,
        volume: fallbackFile.volumeUuid,
        hint: `mount ${fallbackFile.lastMount}`,
      });
    }
    throw error;
  }
}

function errorData(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}
