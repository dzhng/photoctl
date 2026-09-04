import { probeImage, type EmbeddedJpeg } from "@photoctl/importer";
import { identifyFile, type VolumeResolver } from "@photoctl/library";
import type { ImageSource } from "@photoctl/render";
import type { StoredPhoto } from "./photo.js";

export type StoredFile = StoredPhoto["files"][number];

export interface SelectedSource {
  file: StoredFile;
  source: Exclude<ImageSource, { kind: "pinned-preview" }>;
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
  if (!path || !(await matchesCataloguedIdentity(path, photo.contentKey, photo.size))) {
    return undefined;
  }
  const probe = await probeImage(path);
  if (!probe) return undefined;
  if (probe.kind === "image") {
    return {
      file,
      source: {
        kind: "online-file",
        path,
        mediaType: probe.mediaType,
        w: photo.w,
        h: photo.h,
        copyExact: probe.copyExact,
      },
    };
  }
  const full = chooseFullTier(file.embedded);
  return full
    ? {
        file,
        source: {
          kind: "online-jpeg-range",
          path,
          mediaType: "image/jpeg",
          offset: full.offset,
          length: full.length,
          w: full.width,
          h: full.height,
          copyExact: true,
        },
      }
    : undefined;
}

async function matchesCataloguedIdentity(
  path: string,
  contentKey: string,
  size: number,
): Promise<boolean> {
  try {
    const current = await identifyFile(path);
    return current.contentKey === contentKey && current.size === size;
  } catch {
    return false;
  }
}

function chooseFullTier(previews: EmbeddedJpeg[]): EmbeddedJpeg | undefined {
  return previews.toSorted(
    (left, right) => right.width * right.height - left.width * left.height,
  )[0];
}
