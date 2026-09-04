import {
  PhotoctlError,
  type Envelope,
  type ErrorCode,
  type ExportResult,
  type Warning,
} from "@photoctl/protocol";
import { cacheRootForLibrary, type EmbeddedJpeg } from "@photoctl/importer";
import {
  createVolumeResolver,
  resolvePhotoId,
  type LibraryHandle,
  type VolumeResolver,
} from "@photoctl/library";
import { exportEmbeddedJpeg } from "@photoctl/render";
import { mkdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { hasErrorCode } from "../errors.js";
import { loadPhoto } from "../photo.js";

export async function exportCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
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
  await mkdir(resolvedOutputDirectory, { recursive: true });

  const handle = await openRequestLibrary(env, cwd);
  try {
    const libraryId = await readLibraryId(handle);
    const resolver = createVolumeResolver(env.volumeMap);
    const results: Array<ExportResult | ExportFailure> = [];
    const warnings: Warning[] = [];
    for (const input of parsed.positionals) {
      try {
        // Keep result and write order deterministic; output names may collide across inputs.
        // oxlint-disable-next-line eslint/no-await-in-loop
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
          continue;
        }
        throw error;
      }
    }
    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      return {
        schema: 1,
        ok: false,
        code: failed.length === results.length ? failed[0].code : "partial",
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
    await handle.close();
  }
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
  const file = photo.files[0];
  if (!file) throw new PhotoctlError("file_offline", `Photo has no source: ${id}`, { id });
  const source = await resolver.resolve(file.volumeUuid, file.relPath);
  const full = chooseFullTier(file.embedded);
  if (!full) {
    throw new PhotoctlError("unsupported_file", `Photo has no embedded JPEG: ${id}`, { id });
  }
  const outputPath = join(outputDirectory, `${basename(file.relPath, extname(file.relPath))}.jpg`);
  try {
    const exported = await exportEmbeddedJpeg({
      id,
      orientation: photo.orientation,
      outputPath,
      online:
        source.online && source.path
          ? {
              path: source.path,
              offset: full.offset,
              length: full.length,
              w: full.width,
              h: full.height,
            }
          : undefined,
      pinnedPath: join(cacheRoot, "emb", `${id}.jpg`),
    });
    const { warnings, ...data } = exported;
    return { result: { id, ok: true, ...data }, warnings };
  } catch (error) {
    if (hasErrorCode(error, "file_offline")) {
      throw new PhotoctlError("file_offline", error.message, {
        id,
        volume: file.volumeUuid,
        hint: `mount ${file.lastMount}`,
      });
    }
    throw error;
  }
}

function chooseFullTier(previews: EmbeddedJpeg[]): EmbeddedJpeg | undefined {
  return previews.toSorted(
    (left, right) => right.width * right.height - left.width * left.height,
  )[0];
}

function errorData(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}
