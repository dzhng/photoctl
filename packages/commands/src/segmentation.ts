import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { completeModelManifest, PINNED_MODEL_RELEASE, type LibraryHandle } from "@photoctl/library";
import {
  createSam2OnnxRuntime,
  Sam2Segmenter,
  loadActiveDocument,
  readActiveDevelopState,
  prepareSam2Frame,
  readCanvasPlan,
  sam2GroundingPixels,
  type SceneLinearImage,
  type RuntimeDiagnosticSink,
  type RuntimeDiagnostics,
} from "@photoctl/render";
import {
  GatewayClient,
  GatewayStructuredModelAdapter,
  readProviderSettings,
  resolveModels,
} from "@photoctl/providers";
import { PhotoctlError, type StderrEvent } from "@photoctl/protocol";
import sharp from "sharp";
import type { RequestEnv } from "./context.js";
import type { StoredPhoto } from "./photo.js";
import type { SegmentationDependencies } from "./handlers/segment.js";
import { withGenerationSource } from "./handlers/generation-source.js";
import { graphSourceWarning } from "./graph-source.js";

export function createLibrarySegmenter(libraryPath: string): Sam2Segmenter {
  return new Sam2Segmenter(async (diagnostics) => {
    const manifest = completeModelManifest(PINNED_MODEL_RELEASE);
    if (!manifest)
      throw new PhotoctlError("provider_unconfigured", "Model export manifest is incomplete", {
        reason: "model_manifest_incomplete",
      });
    const bytes = await Promise.all(
      ["encoder.onnx", "decoder.onnx"].map(async (file) => {
        const artifact = manifest.artifacts.find((entry) => entry.file === file);
        let data: Buffer;
        try {
          data = await readFile(join(libraryPath, "models", file));
        } catch {
          throw new PhotoctlError(
            "provider_unconfigured",
            "Pinned SAM model is missing; run doctor --fetch-models",
            { reason: "model_missing", file },
          );
        }
        if (!artifact || createHash("sha256").update(data).digest("hex") !== artifact.sha256)
          throw new PhotoctlError(
            "provider_unconfigured",
            "Pinned SAM model hash does not match; run doctor --fetch-models",
            { reason: "model_hash_mismatch", file },
          );
        return data;
      }),
    );
    return createSam2OnnxRuntime(bytes[0]!, bytes[1]!, diagnostics);
  });
}

export async function configuredSegmentation(
  handle: LibraryHandle,
  env: RequestEnv,
  cwd: string,
  photo: StoredPhoto,
  text: boolean,
  segmenter = createLibrarySegmenter(handle.path),
  emit?: (event: StderrEvent) => void | Promise<void>,
): Promise<SegmentationDependencies> {
  await withRuntimeDiagnostics((diagnostics) => segmenter.ready(diagnostics), emit);
  if (text && !env.gatewayApiKey)
    throw new PhotoctlError("provider_unconfigured", "AI_GATEWAY_API_KEY is not configured");
  const document = await loadActiveDocument(handle, photo.id);
  const state = document
    ? await readActiveDevelopState(handle, { photoId: photo.id, orientation: photo.orientation })
    : undefined;
  const develop = state?.develop ?? {};
  const canvas = state ? await readCanvasPlan(handle, photo.id, state.outputNodeId) : undefined;
  const {
    prepared,
    point,
    box: mapBox,
    matrix,
    grounding,
    fallback,
  } = await withGenerationSource(
    handle,
    env,
    cwd,
    photo,
    {},
    async ({ source, sourceContext: selectedContext, fallback: selectedFallback }) => {
      if (typeof source !== "function") throw new Error("SAM source must materialize pixels");
      const { image } = await source();
      if (image.space !== "scene-linear-rec2020")
        throw new Error("SAM source is not scene-linear Rec.2020");
      const frame = await prepareSam2Frame(image as SceneLinearImage, develop, photo, canvas);
      let groundingImage;
      if (text) {
        const pixels = sam2GroundingPixels(frame.image);
        groundingImage = {
          bytes: await sharp(pixels.data, {
            raw: { width: pixels.w, height: pixels.h, channels: 3 },
          })
            .jpeg()
            .toBuffer(),
          mediaType: "image/jpeg" as const,
          dimensions: { w: frame.image.w, h: frame.image.h },
        };
      }
      return {
        prepared: await segmenter.prepare({
          photoId: photo.id,
          tier: selectedContext.tier === "pinned-preview" ? "offline" : "develop",
          image: frame.image,
        }),
        point: frame.point,
        box: frame.box,
        matrix: frame.matrix,
        grounding: groundingImage,
        fallback: selectedFallback,
      };
    },
  );
  const sourceWarning = graphSourceWarning(photo.id, fallback);
  const dependencies: SegmentationDependencies = {
    groundingSpace: "render",
    warnings: sourceWarning ? [sourceWarning] : [],
    local: {
      segment: async ({ points, box, boxSpace }) => {
        const mappedPoints = points.map(point);
        if (
          mappedPoints.some(
            ([x, y]) => x < 0 || y < 0 || x >= prepared.dimensions.w || y >= prepared.dimensions.h,
          )
        )
          throw new PhotoctlError("usage", "Segment point is outside the current develop crop", {
            id: photo.id,
          });
        return await withRuntimeDiagnostics(
          (diagnostics) =>
            prepared.segment(
              {
                projection: { dimensions: { w: photo.w, h: photo.h }, baseToImage: matrix },
                points: mappedPoints,
                ...(box ? { box: boxSpace === "render" ? box : mapBox(box) } : {}),
              },
              diagnostics,
            ),
          emit,
        );
      },
    },
  };
  if (text) {
    dependencies.image = grounding;
    dependencies.structured = new GatewayStructuredModelAdapter({
      gateway: new GatewayClient({ apiKey: env.gatewayApiKey, baseUrl: env.gatewayUrl }),
      model: resolveModels((await readProviderSettings(handle)).models).structured,
    });
  }
  return dependencies;
}

async function withRuntimeDiagnostics<T>(
  operation: (diagnostics: RuntimeDiagnosticSink) => Promise<T>,
  emit?: (event: StderrEvent) => void | Promise<void>,
): Promise<T> {
  const batches: RuntimeDiagnostics[] = [];
  try {
    return await operation((batch) => batches.push(batch));
  } finally {
    // Preserve per-scope order and await backpressure from the stderr owner.
    /* eslint-disable no-await-in-loop */
    for (const batch of batches) {
      for (const diagnostic of batch.diagnostics) {
        await emit?.({
          event: "warn",
          code: "runtime_warning",
          message: `[${diagnostic.scope} ${diagnostic.severity}] ${diagnostic.message}${diagnostic.codeLocation ? ` (${diagnostic.codeLocation})` : ""}${diagnostic.truncated ? " [truncated]" : ""}`,
        });
      }
      if (batch.droppedDiagnostics)
        await emit?.({
          event: "warn",
          code: "runtime_warning",
          message: `Native runtime diagnostics exceeded their retention limit; ${batch.droppedDiagnostics} messages were dropped`,
        });
    }
    /* eslint-enable no-await-in-loop */
  }
}
