import { probeImage, type EmbeddedJpeg, type ImageProbe } from "@photoctl/importer";
import { fullFileHash, identifyFile, type VolumeResolver } from "@photoctl/library";
import type { ImageSource, SourceExecutionProvenance } from "@photoctl/render";
import type { StoredPhoto } from "./photo.js";

export type StoredFile = StoredPhoto["files"][number];

export interface SelectedSource {
  file: StoredFile;
  source: Exclude<ImageSource, { kind: "pinned-preview" }>;
  probe: ImageProbe;
}

export function selectedSourceLocator(
  selected: SelectedSource,
): SourceExecutionProvenance["locator"] {
  return selected.source.kind === "online-jpeg-range"
    ? {
        kind: "online-jpeg-range",
        volume_uuid: selected.file.volumeUuid,
        rel_path: selected.file.relPath,
        offset: selected.source.offset,
        length: selected.source.length,
      }
    : {
        kind: "online-file",
        volume_uuid: selected.file.volumeUuid,
        rel_path: selected.file.relPath,
      };
}

export async function resolveOnlineImageSource(
  photo: StoredPhoto,
  resolver: VolumeResolver,
  index = 0,
): Promise<SelectedSource | undefined> {
  const file = photo.files[index];
  if (!file) return undefined;
  const selected = await selectFileSource(photo, file, resolver);
  return selected ?? (await resolveOnlineImageSource(photo, resolver, index + 1));
}

export async function resolveOnlineOriginalSource(
  photo: StoredPhoto,
  resolver: VolumeResolver,
  index = 0,
): Promise<SelectedSource | undefined> {
  const file = photo.files[index];
  if (!file) return undefined;
  try {
    const resolved = await resolver.resolve(file.volumeUuid, file.relPath);
    const path = resolved.online ? resolved.path : undefined;
    if (
      path &&
      (await matchesCataloguedIdentity(path, photo.contentKey, photo.contentHash, photo.size))
    ) {
      const probe = await probeImage(path);
      if (probe) {
        return {
          file,
          probe,
          source: {
            kind: "online-file",
            path,
            mediaType: probe.mediaType,
            w: probe.dimensions.w,
            h: probe.dimensions.h,
            orientation: photo.orientation,
            copyExact: probe.copyExact,
          },
        };
      }
    }
  } catch {
    // Another locator may still be online and valid.
  }
  return await resolveOnlineOriginalSource(photo, resolver, index + 1);
}

export function fileDecodeSource(
  photo: StoredPhoto,
  selected: SelectedSource,
): Exclude<ImageSource, { kind: "pinned-preview" }> | undefined {
  if (selected.probe.kind === "image") return selected.source;
  const full = chooseFullTier(selected.file.embedded);
  return full
    ? {
        kind: "online-jpeg-range",
        path: selected.source.path,
        mediaType: "image/jpeg",
        offset: full.offset,
        length: full.length,
        w: full.width,
        h: full.height,
        orientation: photo.orientation,
        copyExact: true,
      }
    : undefined;
}

async function selectFileSource(
  photo: StoredPhoto,
  file: StoredFile,
  resolver: VolumeResolver,
): Promise<SelectedSource | undefined> {
  let path: string | undefined;
  try {
    const resolved = await resolver.resolve(file.volumeUuid, file.relPath);
    path = resolved.online ? (resolved.path ?? undefined) : undefined;
  } catch {
    return undefined;
  }
  if (
    !path ||
    !(await matchesCataloguedIdentity(path, photo.contentKey, photo.contentHash, photo.size))
  ) {
    return undefined;
  }
  const probe = await probeImage(path);
  if (!probe) return undefined;
  if (probe.kind === "image") {
    return {
      file,
      probe,
      source: {
        kind: "online-file",
        path,
        mediaType: probe.mediaType,
        w: photo.w,
        h: photo.h,
        orientation: photo.orientation,
        copyExact: probe.copyExact,
      },
    };
  }
  const full = chooseFullTier(file.embedded);
  return full
    ? {
        file,
        probe,
        source: {
          kind: "online-jpeg-range",
          path,
          mediaType: "image/jpeg",
          offset: full.offset,
          length: full.length,
          w: full.width,
          h: full.height,
          orientation: photo.orientation,
          copyExact: true,
        },
      }
    : undefined;
}

async function matchesCataloguedIdentity(
  path: string,
  contentKey: string,
  contentHash: string | null,
  size: number,
): Promise<boolean> {
  try {
    const current = await identifyFile(path);
    if (current.contentKey !== contentKey || current.size !== size) return false;
    return contentHash === null || (await fullFileHash(path)) === contentHash;
  } catch {
    return false;
  }
}

function chooseFullTier(previews: EmbeddedJpeg[]): EmbeddedJpeg | undefined {
  return previews.toSorted(
    (left, right) => right.width * right.height - left.width * left.height,
  )[0];
}
