import { resolveMacHelperPath } from "@photoctl/mac-helper";
import type { VolumeResolver } from "@photoctl/library";
import {
  CirawDecoder,
  FileImageDecoder,
  LibrawDecoder,
  renderLinearSource,
  renderSourceExecution,
  selectDecoder,
  type Decoder,
  type ImageSource,
  type LinearImage,
  type SourceExecutionProvenance,
} from "@photoctl/render";
import type { RequestEnv } from "./context.js";
import type { Warning } from "@photoctl/protocol";
import {
  fileDecodeSource,
  resolveOnlineOriginalSource,
  selectedSourceLocator,
  type StoredFile,
} from "./image-source.js";
import type { StoredPhoto } from "./photo.js";

export type GraphSourceFallback = "decoder_fallback" | "source_offline" | null;

export interface GraphSourceCandidate {
  source: ImageSource;
  file?: StoredFile;
  fallback: GraphSourceFallback;
  produce(): Promise<{ image: LinearImage; provenance: SourceExecutionProvenance }>;
}

export function graphSourceWarning(id: string, fallback: GraphSourceFallback): Warning | undefined {
  if (fallback === "decoder_fallback") {
    return {
      code: "decoder_fallback",
      id,
      message: "Used a file preview because the full-resolution source could not be decoded",
    };
  }
  if (fallback === "source_offline") {
    return {
      code: "source_offline",
      id,
      message: "Used the pinned preview because no online source is available",
    };
  }
  return undefined;
}

/** Resolves the one ordered full-file → embedded → pinned source ladder shared by graph consumers. */
export async function resolveGraphSources(options: {
  photo: StoredPhoto;
  resolver: VolumeResolver;
  pinned: ImageSource;
  pinnedLocator: SourceExecutionProvenance["locator"];
  env: RequestEnv;
}): Promise<GraphSourceCandidate[]> {
  const original = await resolveOnlineOriginalSource(options.photo, options.resolver);
  const candidates: GraphSourceCandidate[] = [];
  if (original?.probe.kind === "raw") {
    const embedded = fileDecodeSource(options.photo, original);
    const selected = await selectDecoder({
      requested: "auto",
      probe: original.probe,
      original: original.source,
      fallback: embedded ?? options.pinned,
      decoders: {
        file: new FileImageDecoder(),
        ciraw: new CirawDecoder(resolveMacHelperPath(options.env.macHelperPath)),
        libraw: new LibrawDecoder(),
      },
    });
    if (!selected.fellBack) {
      candidates.push(
        nativeCandidate(
          selected.decoder,
          selected.probe?.decoderVersion ?? selected.decoder.id,
          original.source,
          selectedSourceLocator(original),
          original.file,
        ),
      );
    }
    if (embedded) {
      candidates.push(
        fileCandidate(
          embedded,
          selectedSourceLocator({ ...original, source: embedded }),
          "decoder_fallback",
          original.file,
        ),
      );
    }
  } else if (original) {
    candidates.push(
      fileCandidate(original.source, selectedSourceLocator(original), null, original.file),
    );
  }
  candidates.push(
    fileCandidate(
      options.pinned,
      options.pinnedLocator,
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
    produce: async () => await renderSourceExecution(source.orientation ?? 1, source, locator),
  };
}

function nativeCandidate(
  decoder: Decoder,
  decoderVersion: string,
  source: ImageSource,
  locator: SourceExecutionProvenance["locator"],
  file: StoredFile,
): GraphSourceCandidate {
  return {
    source,
    file,
    fallback: null,
    produce: async () => {
      const image = await renderLinearSource(await decoder.decode(source, { scale: 1 }));
      return {
        image,
        provenance: {
          locator,
          tier: source.kind,
          w: image.w,
          h: image.h,
          decoderId: decoder.id,
          decoderVersion,
        },
      };
    },
  };
}
