import {
  InvalidXmpError,
  XmpChangedError,
  XmpFilesystemError,
  createVolumeResolver,
  readXmpPath,
  recordXmpState,
  sidecarPathForImage,
  syncXmpToPhoto,
  writeXmpSidecar,
  type LibraryHandle,
  type WriteXmpHooks,
  type XmpCullMetadata,
} from "@photoctl/library";
import { PhotoctlError, type Envelope, type Warning, type XmpResult } from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { batchEnvelope, batchFailure, resolveBatchInputs } from "../batch.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { resolveOnlineOriginalSource } from "../image-source.js";
import { loadPhoto, type StoredPhoto } from "../photo.js";

export interface XmpCommandHooks {
  writeHooks?: (id: string) => WriteXmpHooks | undefined;
}

export async function xmpCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  hooks: XmpCommandHooks = {},
): Promise<Envelope> {
  const subcommand = args[0];
  if (subcommand !== "write" && subcommand !== "sync") {
    throw new PhotoctlError("usage", "xmp requires write or sync");
  }
  const parsed = parseArguments(args.slice(1), {
    flags: subcommand === "sync" ? ["--read"] : [],
  });
  if (parsed.positionals.length === 0) {
    throw new PhotoctlError("usage", `xmp ${subcommand} requires at least one photo ID`);
  }
  if (subcommand === "sync" && !parsed.flags.has("--read")) {
    throw new PhotoctlError("usage", "xmp sync requires --read");
  }

  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const resolver = createVolumeResolver(env.volumeMap, lease.handle.path);
    const resolved = await resolveBatchInputs(lease.handle, parsed.positionals);
    const results: XmpResult[] = [];
    const warnings: Warning[] = [];
    for (const item of resolved) {
      if (!item.ok) {
        results.push(item);
        continue;
      }
      try {
        const photo = await loadPhoto(lease.handle, item.id);
        const source = await resolveOnlineOriginalSource(photo, resolver);
        if (!source) {
          throw new PhotoctlError("file_offline", "No matching source locator is online", {
            id: item.id,
          });
        }
        const imagePath = source.source.path;
        if (subcommand === "write") {
          const metadata = await readCatalogMetadata(lease.handle, photo);
          const written = await writeXmpSidecar(imagePath, metadata, hooks.writeHooks?.(item.id));
          await recordXmpState(lease.handle, item.id, written.path, written.mtime);
          results.push({ id: item.id, ok: true, action: "written", sidecar: written.path });
        } else {
          const path = sidecarPathForImage(imagePath);
          const xmp = await readXmpPath(path);
          if (!xmp) throw new PhotoctlError("not_found", "XMP sidecar not found", { path });
          await syncXmpToPhoto(lease.handle, item.id, xmp);
          if (xmp.labelUnknown) {
            warnings.push({
              code: "label_unknown",
              id: item.id,
              message: `Unknown XMP label: ${xmp.labelUnknown}`,
            });
          }
          results.push({ id: item.id, ok: true, action: "read", sidecar: path });
        }
      } catch (error) {
        results.push(batchFailure(item.id, normalizeXmpError(error, item.id)));
      }
    }
    return { ...batchEnvelope(results), warnings };
  } finally {
    await lease.release();
  }
}

async function readCatalogMetadata(
  handle: LibraryHandle,
  photo: StoredPhoto,
): Promise<XmpCullMetadata> {
  const tags = await handle.query<{ tag: string }>(
    "SELECT tag FROM tags WHERE photo_id = $1 ORDER BY tag",
    [photo.id],
  );
  return {
    rating: photo.rating,
    flag: photo.flag,
    label: photo.label,
    tags: tags.rows.map((tag) => tag.tag),
  };
}

function normalizeXmpError(error: unknown, id: string): PhotoctlError {
  if (error instanceof PhotoctlError) return error;
  if (error instanceof InvalidXmpError) {
    return new PhotoctlError("unsupported_file", error.message, { id });
  }
  if (error instanceof XmpChangedError) {
    return new PhotoctlError("unsupported_file", error.message, { id });
  }
  if (error instanceof XmpFilesystemError && error.code === "ENOENT") {
    return new PhotoctlError("file_offline", "The source folder became unavailable", { id });
  }
  if (
    error instanceof XmpFilesystemError &&
    ["EROFS", "EACCES", "EPERM"].includes(error.code ?? "")
  ) {
    return new PhotoctlError("volume_readonly", "The source volume does not allow sidecar writes", {
      id,
    });
  }
  if (error instanceof XmpFilesystemError) {
    return new PhotoctlError("unsupported_file", error.message, {
      id,
      ...(error.code ? { cause: error.code } : {}),
    });
  }
  throw error;
}
