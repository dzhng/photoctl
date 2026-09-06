/* eslint-disable no-await-in-loop -- Source fallbacks must stop before the paid provider call. */
import { createVolumeResolver, type LibraryHandle } from "@photoctl/library";
import { cacheRootForLibrary, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import {
  SourceEvaluationError,
  readRetainedGraphOutput,
  evaluateRetainedGraphNode,
  type EvaluatedNode,
  type FillGenerationDependencies,
  type ImageSource,
} from "@photoctl/render";
import type { UpscaleRegistry } from "@photoctl/providers";
import { PhotoctlError } from "@photoctl/protocol";
import { cacheBase, readLibraryId, type RequestEnv } from "../context.js";
import { resolveGraphSources, type GraphSourceFallback } from "../graph-source.js";
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
  dependencies: Pick<GenerationCommandDependencies, "source" | "sourceContext">,
  run: (input: {
    source: import("@photoctl/render").EvaluateGraphNodeRequest["source"];
    sourceContext: import("@photoctl/render").SourceContextDensity;
    fallback: GraphSourceFallback;
    inputEvaluation?: EvaluatedNode;
  }) => Promise<T>,
  retainedInputNodeId?: string,
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
  if (candidates.length === 0 && !dependencies.source && !retainedInputNodeId) {
    throw new PhotoctlError("file_offline", "No usable image source is available", { id: photoId });
  }
  // Import persists oriented dimensions, so applying EXIF orientation here would swap 5–8 twice.
  const dimensions = { w: photo.w, h: photo.h };
  const retainedInput = async (
    minimumSource?: Parameters<typeof readRetainedGraphOutput>[0]["minimumSource"],
  ) => {
    if (!retainedInputNodeId) return undefined;
    const retainedRequest = {
      database: handle,
      libraryPath: handle.path,
      photoId,
      nodeId: retainedInputNodeId,
      minimumSource,
    };
    let retained = await readRetainedGraphOutput(retainedRequest);
    if (!retained) {
      try {
        await evaluateRetainedGraphNode(retainedRequest);
        retained = await readRetainedGraphOutput(retainedRequest);
      } catch (error) {
        if (error instanceof SourceEvaluationError) return undefined;
        throw error;
      }
    }
    if (!retained) return undefined;
    if (!retained.sourceTier) return undefined;
    const pixelScale = Math.min(
      1,
      retained.frame.source.w / dimensions.w,
      retained.frame.source.h / dimensions.h,
    );
    return {
      source: undefined,
      inputEvaluation: { ...retained, reused: true },
      sourceContext: {
        tier: retained.sourceTier,
        pixelScale,
        resolutionLimited: pixelScale + 1 / Math.max(dimensions.w, dimensions.h) < 1,
      },
      fallback: "source_offline" as const,
    };
  };
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
      if ("fallback" in entry && entry.fallback && "source" in entry) {
        const retained = await retainedInput({
          dimensions: {
            w: dimensions.w * sourceContext.pixelScale,
            h: dimensions.h * sourceContext.pixelScale,
          },
          tier: entry.source.kind,
        });
        if (retained) return await run({ ...retained, fallback: entry.fallback });
      }
      return await run({
        source,
        sourceContext,
        fallback: "fallback" in entry ? entry.fallback : null,
      });
    } catch (error) {
      if (!(error instanceof SourceEvaluationError)) throw error;
      lastSourceError = error;
    }
  }
  const retained = await retainedInput();
  if (retained) return await run(retained);
  throw new PhotoctlError("file_offline", "No usable image source is available", {
    id: photoId,
    reason: lastSourceError?.message,
  });
}
