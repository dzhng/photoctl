import { createHash } from "node:crypto";
import {
  createSam2OnnxRuntime,
  resamplePixels,
  sam2MaskFromLogits,
  type Sam2OnnxRuntime,
  type Sam2TensorOutput,
} from "@photoctl/img";
import { prepareSam2EncoderInput, type Sam2Letterbox } from "./sam2.js";
import type { MaskImage } from "./mask-tiff.js";
import { composeTransformMatrices, type TransformMatrix } from "./transforms.js";

export { createSam2OnnxRuntime };
export type { Sam2OnnxRuntime };
const featureShapes = [
  [1, 32, 256, 256],
  [1, 64, 128, 128],
  [1, 256, 64, 64],
];
const featureNames = ["image_features_0", "image_features_1", "image_embeddings"];
type Encoded = { features: Sam2TensorOutput[]; mapping: Sam2Letterbox };

/** One library's lazy CPU sessions and bounded LRU of 16 MiB encoder feature sets. */
export class Sam2Segmenter {
  #runtime?: Promise<Sam2OnnxRuntime>;
  readonly #entries = new Map<string, { hash: string; result: Promise<Encoded> }>();
  constructor(
    private readonly load: () => Promise<Sam2OnnxRuntime>,
    private readonly capacity = 8,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("SAM cache capacity must be positive");
  }

  async ready(): Promise<void> {
    await this.runtime();
  }

  clear(): void {
    this.#entries.clear();
    this.#runtime = undefined;
  }

  async segment(request: {
    photoId: string;
    tier: "develop" | "offline";
    image: { w: number; h: number; data: Float32Array };
    points: Array<[number, number]>;
    box?: [number, number, number, number];
    projection?: { dimensions: { w: number; h: number }; baseToImage: TransformMatrix };
  }): Promise<MaskImage> {
    const runtime = await this.runtime();
    const { image } = request;
    const hash = createHash("sha256")
      .update(`${image.w},${image.h}\0`)
      .update(new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength))
      .digest("hex");
    const key = JSON.stringify([request.photoId, request.tier]);
    let entry = this.#entries.get(key);
    this.#entries.delete(key);
    if (!entry || entry.hash !== hash) {
      const result = prepareSam2EncoderInput(image.data, image, resamplePixels).then(
        async ({ data, mapping }) => {
          const features = await runtime.runEncoder(
            [{ name: "image", dimensions: [1, 3, 1024, 1024], f32Data: data }],
            featureNames,
          );
          if (features.length !== 3) throw new Error("SAM encoder returned incomplete features");
          features.forEach((feature, index) => assertTensor(feature, featureShapes[index]!));
          return { features, mapping };
        },
      );
      entry = { hash, result };
    }
    this.#entries.set(key, entry);
    while (this.#entries.size > this.capacity)
      this.#entries.delete(this.#entries.keys().next().value!);
    let encoded: Encoded;
    try {
      encoded = await entry.result;
    } catch (error) {
      if (this.#entries.get(key) === entry) this.#entries.delete(key);
      throw error;
    }
    const points = request.points.map((point) => encoded.mapping.toModel(point));
    const labels = points.map(() => 1);
    if (request.box) {
      const [x, y, w, h] = request.box;
      points.push(encoded.mapping.toModel([x, y]), encoded.mapping.toModel([x + w, y + h]));
      labels.push(2, 3);
    }
    // The pinned exporter appends its own not-a-point token, including for box prompts.
    const [logits] = await runtime.runDecoder(
      [
        ...encoded.features.map((feature, index) => ({
          name: featureNames[index]!,
          dimensions: feature.dimensions,
          f32Data: feature.data,
        })),
        {
          name: "point_coords",
          dimensions: [1, points.length, 2],
          f32Data: new Float32Array(points.flat()),
        },
        { name: "point_labels", dimensions: [1, points.length], i32Data: new Int32Array(labels) },
        { name: "input_masks", dimensions: [1, 1, 256, 256], f32Data: new Float32Array(256 * 256) },
        { name: "has_input_masks", dimensions: [1], f32Data: new Float32Array([0]) },
        { name: "original_image_size", dimensions: [2], i32Data: new Int32Array([1024, 1024]) },
      ],
      ["low_res_masks"],
    );
    if (!logits) throw new Error("SAM decoder returned no mask");
    assertTensor(logits, [1, 1, 256, 256]);
    const { mapping } = encoded;
    const dimensions = request.projection?.dimensions ?? image;
    const baseToModel = request.projection
      ? composeTransformMatrices(
          [
            mapping.resized.w / image.w,
            0,
            0,
            mapping.resized.h / image.h,
            mapping.offset.x,
            mapping.offset.y,
          ],
          request.projection.baseToImage,
        )
      : undefined;
    return {
      w: dimensions.w,
      h: dimensions.h,
      data: sam2MaskFromLogits(logits.data, 256, 256, {
        modelSize: 1024,
        resizedWidth: mapping.resized.w,
        resizedHeight: mapping.resized.h,
        offsetX: mapping.offset.x,
        offsetY: mapping.offset.y,
        baseWidth: dimensions.w,
        baseHeight: dimensions.h,
        baseToModel,
      }),
    };
  }

  private async runtime(): Promise<Sam2OnnxRuntime> {
    const pending = (this.#runtime ??= this.load());
    try {
      return await pending;
    } catch (error) {
      if (this.#runtime === pending) this.#runtime = undefined;
      throw error;
    }
  }
}

function assertTensor(tensor: Sam2TensorOutput, shape: number[]): void {
  if (
    tensor.dimensions.length !== shape.length ||
    shape.some((value, index) => value !== tensor.dimensions[index]) ||
    tensor.data.length !== shape.reduce((a, b) => a * b, 1) ||
    tensor.data.some((value) => !Number.isFinite(value))
  )
    throw new Error("SAM model returned invalid tensor dimensions or values");
}
