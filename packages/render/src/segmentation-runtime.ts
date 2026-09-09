import { createHash } from "node:crypto";
import {
  createSegmentationRuntime,
  type SegmentationRuntime,
  type SegmentationTensorOutput,
  type RuntimeDiagnosticSink,
} from "@photoctl/img";
import { prepareZimEncoderInput, restoreZimMask, type ZimMapping } from "./zim.js";
import type { GroundedInstance } from "@photoctl/providers";
import type { MaskImage } from "./mask-tiff.js";
import type { TransformMatrix } from "./transforms.js";

export { createSegmentationRuntime };
export type { SegmentationRuntime };
export type { RuntimeDiagnosticSink, RuntimeDiagnostics } from "@photoctl/img";
const featureShapes = [
  [1, 256, 64, 64],
  [1, 64, 512, 512],
  [1, 128, 256, 256],
  [1, 256, 128, 128],
];
const featureNames = ["image_embeddings", "feat_D0", "feat_D1", "feat_D2"];
type Encoded = { features: SegmentationTensorOutput[]; mapping: ZimMapping };
type EncoderInput = Awaited<ReturnType<typeof prepareZimEncoderInput>>;
type CacheEntry = { hash: string; result: Promise<Encoded> };
type Prompt = {
  points: GroundedInstance["points"];
  box?: [number, number, number, number];
  projection?: { dimensions: { w: number; h: number }; baseToImage: TransformMatrix };
};
export interface PreparedSegmentationImage {
  readonly dimensions: { w: number; h: number };
  segment(request: Prompt, diagnostics?: RuntimeDiagnosticSink): Promise<MaskImage>;
}

/** One library's lazy CPU sessions and bounded cache of 116 MiB encoder feature sets. */
export class ZimSegmenter {
  #runtime?: Promise<SegmentationRuntime>;
  readonly #entries = new Map<string, CacheEntry>();
  constructor(
    private readonly load: (diagnostics?: RuntimeDiagnosticSink) => Promise<SegmentationRuntime>,
    private readonly capacity = 1,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Segment cache capacity must be positive");
  }

  async ready(diagnostics?: RuntimeDiagnosticSink): Promise<void> {
    await this.runtime(diagnostics);
  }

  clear(): void {
    this.#entries.clear();
    this.#runtime = undefined;
  }

  async prepare(request: {
    photoId: string;
    tier: "develop" | "offline";
    image: { w: number; h: number; data: Float32Array };
  }): Promise<PreparedSegmentationImage> {
    await this.runtime();
    const { image } = request;
    const hash = createHash("sha256")
      .update(`${image.w},${image.h}\0`)
      .update(new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength))
      .digest("hex");
    const key = JSON.stringify([request.photoId, request.tier]);
    const entry = this.#entries.get(key);
    return this.preparedHandle(
      key,
      hash,
      { w: image.w, h: image.h },
      entry?.hash === hash ? undefined : prepareZimEncoderInput(image.data, image),
      entry?.hash === hash ? entry : undefined,
    );
  }

  // This separate scope cannot capture the source image or its caller's request.
  private preparedHandle(
    key: string,
    hash: string,
    dimensions: PreparedSegmentationImage["dimensions"],
    input: EncoderInput | undefined,
    pinned: CacheEntry | undefined,
  ): PreparedSegmentationImage {
    return {
      dimensions,
      segment: async (request, diagnostics) => {
        if (!pinned) {
          const cached = this.#entries.get(key);
          if (cached?.hash === hash) pinned = cached;
          else {
            if (!input) throw new Error("Segment prepared input is unavailable");
            pinned = { hash, result: this.encode(input, diagnostics) };
            this.#entries.set(key, pinned);
          }
        }
        const entry = pinned;
        if (this.#entries.get(key) === entry) {
          this.#entries.delete(key);
          this.#entries.set(key, entry);
        }
        while (this.#entries.size > this.capacity)
          this.#entries.delete(this.#entries.keys().next().value!);
        let encoded: Encoded;
        try {
          encoded = await entry.result;
          input = undefined;
        } catch (error) {
          if (this.#entries.get(key) === entry) this.#entries.delete(key);
          if (input) pinned = undefined;
          throw error;
        }
        return this.decode(encoded, request, diagnostics);
      },
    };
  }

  private async encode(
    { data, mapping }: EncoderInput,
    diagnostics?: RuntimeDiagnosticSink,
  ): Promise<Encoded> {
    const runtime = await this.runtime(diagnostics);
    const features = await runtime.runEncoder(
      [{ name: "image", dimensions: [1, 3, 1024, 1024], f32Data: data }],
      featureNames,
      diagnostics,
    );
    if (features.length !== featureNames.length)
      throw new Error("Segment encoder returned incomplete features");
    features.forEach((feature, index) => assertTensor(feature, featureShapes[index]!));
    return { features, mapping };
  }

  private async decode(
    encoded: Encoded,
    request: Prompt,
    diagnostics?: RuntimeDiagnosticSink,
  ): Promise<MaskImage> {
    const runtime = await this.runtime(diagnostics);
    const { points, labels, attention } = promptTensors(encoded.mapping, request);
    const [logits, scores] = await runtime.runDecoder(
      [
        ...encoded.features.map((feature, index) => ({
          name: featureNames[index]!,
          dimensions: feature.dimensions,
          f32Data: feature.data,
        })),
        { name: "point_coords", dimensions: [1, labels.length, 2], f32Data: points },
        { name: "point_labels", dimensions: [1, labels.length], f32Data: labels },
        { name: "attn_mask", dimensions: [1, 64, 64], f32Data: attention },
      ],
      ["masks", "iou_predictions"],
      diagnostics,
    );
    if (!logits || !scores) throw new Error("Segment decoder returned incomplete masks or scores");
    assertTensor(logits, [1, 4, 512, 512]);
    assertTensor(scores, [1, 4]);
    let selected = 0;
    for (let index = 1; index < scores.data.length; index += 1)
      if (scores.data[index]! > scores.data[selected]!) selected = index;
    return restoreZimMask(
      logits.data.subarray(selected * 512 * 512, (selected + 1) * 512 * 512),
      { w: 512, h: 512 },
      encoded.mapping,
      request.projection,
    );
  }

  private async runtime(diagnostics?: RuntimeDiagnosticSink): Promise<SegmentationRuntime> {
    const pending = (this.#runtime ??= this.load(diagnostics));
    try {
      return await pending;
    } catch (error) {
      if (this.#runtime === pending) this.#runtime = undefined;
      throw error;
    }
  }
}

function assertTensor(tensor: SegmentationTensorOutput, shape: number[]): void {
  if (
    tensor.dimensions.length !== shape.length ||
    shape.some((value, index) => value !== tensor.dimensions[index]) ||
    tensor.data.length !== shape.reduce((a, b) => a * b, 1) ||
    tensor.data.some((value) => !Number.isFinite(value))
  )
    throw new Error("Segment model returned invalid tensor dimensions or values");
}

function promptTensors(mapping: ZimMapping, request: Prompt) {
  if (request.points.length === 0 && !request.box)
    throw new Error("Segment prompt requires points or a box");
  const points = request.points.map(({ at }) => mapping.toModel(at).map(Math.fround));
  const labels: number[] = request.points.map(({ label }) => label);
  const attention = new Float32Array(64 * 64);
  if (points.length) {
    for (const [px, py] of points) {
      const cx = Math.trunc(px! / 16),
        cy = Math.trunc(py! / 16);
      if (cx < 0 || cy < 0 || cx >= 64 || cy >= 64) continue;
      for (let y = 0; y < 64; y += 1) {
        for (let x = 0; x < 64; x += 1) {
          const value = Math.fround(
            Math.exp(Math.fround(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 21 ** 2))),
          );
          attention[y * 64 + x] = Math.max(attention[y * 64 + x]!, value);
        }
      }
    }
  }
  if (request.box) {
    const [x, y, w, h] = request.box;
    const topLeft = mapping.toModel([x, y]).map(Math.fround);
    const bottomRight = mapping.toModel([x + w, y + h]).map(Math.fround);
    if (!points.length) {
      const left = Math.max(0, Math.trunc(topLeft[0]! / 16));
      const top = Math.max(0, Math.trunc(topLeft[1]! / 16));
      const right = Math.min(64, Math.trunc(bottomRight[0]! / 16) + 1);
      const bottom = Math.min(64, Math.trunc(bottomRight[1]! / 16) + 1);
      for (let row = top; row < bottom; row += 1)
        attention.fill(1, row * 64 + left, row * 64 + right);
    }
    points.push(topLeft, bottomRight);
    labels.push(2, 3);
  } else {
    points.push([-0.5, -0.5]);
    labels.push(-1);
  }
  return { points: new Float32Array(points.flat()), labels: new Float32Array(labels), attention };
}
