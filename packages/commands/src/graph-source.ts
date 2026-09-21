import { pinnedEmbeddedJpegKey, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import { resolveMacHelperPath } from "@photoctl/mac-helper";
import type { VolumeResolver } from "@photoctl/library";
import {
  CirawDecoder,
  FileImageDecoder,
  renderLinearSource,
  renderSourceExecution,
  selectDecoder,
  planSourceTreatment,
  sameSourceTreatment,
  DecoderUnavailableError,
  type DecoderProbe,
  type Decoder,
  type ImageSource,
  type LinearImage,
  type SourceExecutionProvenance,
} from "@photoctl/render";
import type { RequestEnv } from "./context.js";
import { PhotoctlError, type Warning, type SourceTreatment } from "@photoctl/protocol";
import {
  resolveOnlineOriginalSource,
  selectedSourceLocator,
  type StoredFile,
} from "./image-source.js";
import { isRawPhoto, type StoredPhoto } from "./photo.js";

export type GraphSourceFallback = "decoder_fallback" | "source_offline" | null;

export interface GraphSourceCandidate {
  source: ImageSource;
  file?: StoredFile;
  fallback: GraphSourceFallback;
  treatment: SourceTreatment;
  produce(): Promise<{ image: LinearImage; provenance: SourceExecutionProvenance }>;
}

export function graphSourceWarning(id: string, fallback: GraphSourceFallback): Warning | undefined {
  if (fallback === "decoder_fallback") {
    return {
      code: "decoder_fallback",
      id,
      message:
        "Used available preview or retained pixels because the full-resolution source could not be decoded",
    };
  }
  if (fallback === "source_offline") {
    return {
      code: "source_offline",
      id,
      message: "Used available preview or retained pixels because no online source is available",
    };
  }
  return undefined;
}

/** The library's pinned preview JPEG for a photo, as the last-resort graph image source. */
export function pinnedPreviewSource(cacheRoot: string, photoId: string): ImageSource {
  return {
    kind: "pinned-preview",
    path: pinnedEmbeddedJpegPath(cacheRoot, photoId),
    mediaType: "image/jpeg",
    orientation: 1,
  };
}

/** RAW requires reconstructed CIRAW pixels; ordinary images may use their pinned preview. */
export async function resolveGraphSources(options: {
  photo: StoredPhoto;
  resolver: VolumeResolver;
  cacheRoot: string;
  env: RequestEnv;
}): Promise<GraphSourceCandidate[]> {
  const pinned = pinnedPreviewSource(options.cacheRoot, options.photo.id);
  const original = await resolveOnlineOriginalSource(options.photo, options.resolver);
  const candidates: GraphSourceCandidate[] = [];
  if (isRawPhoto(options.photo)) {
    if (!original) {
      throw new PhotoctlError("file_offline", "The RAW original is unavailable", {
        id: options.photo.id,
      });
    }
    try {
      const selected = await selectDecoder({
        requested: "auto",
        probe: original.probe,
        original: original.source,
        fallback: pinned,
        decoders: {
          file: new FileImageDecoder(),
          ciraw: new CirawDecoder(resolveMacHelperPath(options.env.macHelperPath)),
        },
      });
      return [
        nativeCandidate(
          selected.decoder,
          selected.probe,
          original.source,
          selectedSourceLocator(original),
          original.file,
        ),
      ];
    } catch (error) {
      if (error instanceof DecoderUnavailableError) {
        throw new PhotoctlError("decoder_unavailable", error.message, { id: options.photo.id });
      }
      throw error;
    }
  } else if (original) {
    candidates.push(
      fileCandidate(original.source, selectedSourceLocator(original), null, original.file),
    );
  }
  candidates.push(
    fileCandidate(
      pinned,
      { kind: "pinned-preview", cache_path: pinnedEmbeddedJpegKey(options.photo.id) },
      original ? "decoder_fallback" : "source_offline",
    ),
  );
  return candidates;
}

function fileCandidate(
  source: ImageSource,
  locator: SourceExecutionProvenance["locator"],
  fallback: GraphSourceFallback,
  file?: StoredFile,
): GraphSourceCandidate {
  return {
    source,
    file,
    fallback,
    treatment: planSourceTreatment("file", undefined, {
      scale: 1,
      highlightReconstruction: "reconstruct",
    }),
    produce: async () => await renderSourceExecution(source.orientation ?? 1, source, locator),
  };
}

function nativeCandidate(
  decoder: Decoder,
  probe: DecoderProbe | undefined,
  source: ImageSource,
  locator: SourceExecutionProvenance["locator"],
  file: StoredFile,
): GraphSourceCandidate {
  const options = {
    scale: 1,
    outputSpace: "scene-linear-rec2020",
    highlightReconstruction: "reconstruct",
  } as const;
  const treatment = planSourceTreatment(decoder.id, probe, options);
  return {
    source,
    file,
    fallback: null,
    treatment,
    produce: async () => {
      const decoded = await decoder.decode(source, options);
      if (!sameSourceTreatment(decoded.treatment, treatment))
        throw new DecoderUnavailableError("Decoder treatment changed after source planning");
      const image = await renderLinearSource(decoded);
      return {
        image,
        provenance: {
          locator,
          tier: source.kind,
          w: image.w,
          h: image.h,
          decoderId: decoded.treatment.decoderId,
          decoderVersion: decoded.treatment.decoderVersion,
          treatment: decoded.treatment,
        },
      };
    },
  };
}
