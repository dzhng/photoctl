/* eslint-disable no-await-in-loop -- Source fallbacks must stop before the paid provider call. */
import { createVolumeResolver, type LibraryHandle } from "@photoctl/library";
import { cacheRootForLibrary, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import {
  SourceEvaluationError,
  type FillGenerationDependencies,
  type ImageSource,
} from "@photoctl/render";
import type { UpscaleRegistry } from "@photoctl/providers";
import { PhotoctlError } from "@photoctl/protocol";
import { cacheBase, readLibraryId, type RequestEnv } from "../context.js";
import { resolveGraphSources } from "../graph-source.js";
import { loadPhoto } from "../photo.js";

export type GenerationCommandDependencies = FillGenerationDependencies & {
  source?: import("@photoctl/render").EvaluateGraphNodeRequest["source"];
  upscaleRegistry?: UpscaleRegistry;
  upscaleSettings?: import("@photoctl/render").UpscalePolicySettings;
  sourceContext?: import("@photoctl/render").SourceContextDensity;
};

export async function withGenerationSource<T>(
  handle: LibraryHandle,
  env: RequestEnv,
  cwd: string,
  photo: Awaited<ReturnType<typeof loadPhoto>>,
  dependencies: GenerationCommandDependencies,
  run: (input: {
    source: import("@photoctl/render").EvaluateGraphNodeRequest["source"];
    sourceContext: import("@photoctl/render").SourceContextDensity;
  }) => Promise<T>,
): Promise<T> {
  const photoId = photo.id;
  const resolver = createVolumeResolver(env.volumeMap, handle.path);
  const libraryId = await readLibraryId(handle);
  const pinned: ImageSource = {
    kind: "pinned-preview",
    path: pinnedEmbeddedJpegPath(cacheRootForLibrary(libraryId, cacheBase(env, cwd)), photoId),
    mediaType: "image/jpeg",
    orientation: 1,
  };
  const candidates = await resolveGraphSources({
    photo,
    resolver,
    pinned,
    pinnedLocator: { kind: "pinned-preview", cache_path: `emb/${photoId}.jpg` },
    env,
  });
  if (candidates.length === 0 && !dependencies.source) {
    throw new PhotoctlError("file_offline", "No usable image source is available", { id: photoId });
  }
  // Import persists oriented dimensions, so applying EXIF orientation here would swap 5–8 twice.
  const dimensions = { w: photo.w, h: photo.h };
  let lastSourceError: SourceEvaluationError | undefined;
  for (const entry of dependencies.source ? [{ produce: dependencies.source }] : candidates) {
    try {
      let source: import("@photoctl/render").EvaluateGraphNodeRequest["source"] = entry.produce;
      let sourceContext = dependencies.sourceContext;
      if (!sourceContext) {
        if (typeof entry.produce !== "function") {
          throw new Error(
            "Structured generation source dependencies require explicit sourceContext",
          );
        }
        let produced: Awaited<ReturnType<typeof entry.produce>>;
        try {
          produced = await entry.produce();
        } catch (error) {
          throw new SourceEvaluationError(error);
        }
        source = async () => produced;
        const pixelScale = Math.min(
          1,
          produced.provenance.w / dimensions.w,
          produced.provenance.h / dimensions.h,
        );
        sourceContext = {
          tier: produced.provenance.tier,
          pixelScale,
          resolutionLimited: pixelScale + 1 / Math.max(dimensions.w, dimensions.h) < 1,
        };
      }
      return await run({ source, sourceContext });
    } catch (error) {
      if (!(error instanceof SourceEvaluationError)) throw error;
      lastSourceError = error;
    }
  }
  throw new PhotoctlError("file_offline", "No usable image source is available", {
    id: photoId,
    reason: lastSourceError?.message,
  });
}
