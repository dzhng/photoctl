import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { createSam2OnnxRuntime, sam2MaskFromLogits } from "./index.js";

test("the TypeScript seam supplies ONNX bytes to CPU sessions and maps logits", async () => {
  const bytes = await readFile("crates/photoctl-image/tests/data/identity-opset17.onnx");
  const runtime = createSam2OnnxRuntime(bytes, bytes);
  expect(runtime.encoderInputNames()).toEqual(["x"]);
  expect(runtime.decoderInputNames()).toEqual(["x"]);
  expect(
    await runtime.runDecoder(
      [{ name: "x", dimensions: [1, 1, 2, 2], f32Data: new Float32Array([1, 2, 3, 4]) }],
      "y",
    ),
  ).toEqual({ dimensions: [1, 1, 2, 2], data: new Float32Array([1, 2, 3, 4]) });
  expect(
    sam2MaskFromLogits(new Float32Array([-1, 1, -0.25, 0.25]), 2, 2, {
      modelSize: 2,
      resizedWidth: 2,
      resizedHeight: 2,
      offsetX: 0,
      offsetY: 0,
      baseWidth: 2,
      baseHeight: 2,
    }),
  ).toEqual(new Float32Array([0, 1, 0, 1]));
});
