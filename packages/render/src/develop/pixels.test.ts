import { expect, test } from "vitest";
import { encodeArtifactLinearTiff } from "../linear-tiff.js";
import { applyDevelop, applyDevelopArtifact } from "./pixels.js";
import type { LinearImage } from "../decoder.js";

test("develop applies exposure directly to scene-linear Rec.2020 pixels", async () => {
  const source = {
    w: 2,
    h: 1,
    data: new Float32Array([0.125, 0.25, 0.5, 0.75, 1.25, -0.125]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };

  const developed = await applyDevelop(source, { exposure: 1 });

  expect(developed.data).toEqual(new Float32Array([0.25, 0.5, 1, 1.5, 2.5, -0.25]));
});

test("develop rejects camera-space pixels at its public boundary", async () => {
  const camera = {
    w: 1,
    h: 1,
    data: new Float32Array([0.1, 0.2, 0.3]),
    space: "camera",
    orientationApplied: true,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: false,
  } satisfies LinearImage;

  await expect(applyDevelop(camera as never, { exposure: 1 })).rejects.toThrow(
    "scene-linear Rec.2020",
  );
});

test("develop grades canonical artifact bytes asynchronously without a JS pixel decode", async () => {
  const source = {
    w: 2,
    h: 1,
    data: new Float32Array([0.125, 0.25, 0.5, 0.75, 1.25, -0.125]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const bytes = await encodeArtifactLinearTiff(source);
  const developed = await applyDevelopArtifact(bytes, { w: 2, h: 1 }, { exposure: 1 });

  expect(developed.bytes).not.toBe(bytes);
  expect(developed.bytes.subarray(0, developed.pixelOffset)).toEqual(
    bytes.subarray(0, developed.pixelOffset),
  );
  expect(developed.w).toBe(2);
  expect(developed.h).toBe(1);
  const invalid = Buffer.from(bytes);
  invalid.writeFloatLE(Number.NaN, developed.pixelOffset);
  await expect(applyDevelopArtifact(invalid, { w: 2, h: 1 }, { exposure: 1 })).rejects.toThrow(
    "non-finite",
  );
});

test("full-frame artifact grading leaves the JavaScript event loop responsive", async () => {
  const width = 768;
  const height = 512;
  const bytes = await encodeArtifactLinearTiff({
    w: width,
    h: height,
    data: new Float32Array(width * height * 3).fill(0.25),
    space: "scene-linear-rec2020",
    orientationApplied: true,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  });
  let heartbeats = 0;
  const timer = setInterval(() => {
    heartbeats += 1;
  }, 1);
  try {
    await applyDevelopArtifact(bytes, { w: width, h: height }, { exposure: 1 });
  } finally {
    clearInterval(timer);
  }

  expect(heartbeats).toBeGreaterThan(2);
});
