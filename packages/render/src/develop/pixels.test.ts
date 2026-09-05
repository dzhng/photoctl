import { expect, test } from "vitest";
import { decodeArtifactLinearTiff, encodeArtifactLinearTiff } from "../linear-tiff.js";
import { applyDevelop, applyDevelopArtifact } from "./pixels.js";
import type { LinearImage } from "../decoder.js";

function chroma(values: Float32Array, offset: number): number {
  return (
    Math.max(...values.subarray(offset, offset + 3)) -
    Math.min(...values.subarray(offset, offset + 3))
  );
}

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

test("develop highlights select bright tones without moving deep shadows", async () => {
  const source = {
    w: 3,
    h: 1,
    data: new Float32Array([0.02, 0.02, 0.02, 0.18, 0.18, 0.18, 1.2, 1.2, 1.2]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };

  const developed = await applyDevelop(source, { highlights: -50 });

  expect(developed.data[0]).toBeCloseTo(source.data[0]!, 6);
  expect(developed.data[6]).toBeLessThan(source.data[6]! * 0.85);
  expect(developed.data[6]).toBeGreaterThan(0.5);
});

test("develop shadows select dark tones without moving highlights", async () => {
  const source = {
    w: 3,
    h: 1,
    data: new Float32Array([0.02, 0.02, 0.02, 0.18, 0.18, 0.18, 1.2, 1.2, 1.2]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };

  const developed = await applyDevelop(source, { shadows: 50 });

  expect(developed.data[0]).toBeGreaterThan(source.data[0]! * 1.3);
  expect(developed.data[6]).toBeCloseTo(source.data[6]!, 6);
});

test("develop vibrance boosts muted colors more than saturated colors", async () => {
  const source = {
    w: 2,
    h: 1,
    data: new Float32Array([0.36, 0.42, 0.38, 0.1, 0.7, 0.25]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };

  const developed = await applyDevelop(source, { vibrance: 80 });
  const mutedGain = chroma(developed.data, 0) / chroma(source.data, 0);
  const saturatedGain = chroma(developed.data, 3) / chroma(source.data, 3);

  expect(mutedGain).toBeGreaterThan(saturatedGain + 0.2);
});

test("develop vibrance protects warm skin hues", async () => {
  // Channel rotations have equal saturation; only hue changes between the two pixels.
  const source = {
    w: 2,
    h: 1,
    data: new Float32Array([0.5, 0.3, 0.2, 0.2, 0.5, 0.3]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };

  const developed = await applyDevelop(source, { vibrance: 80 });
  const skinGain = chroma(developed.data, 0) / chroma(source.data, 0);
  const greenGain = chroma(developed.data, 3) / chroma(source.data, 3);

  expect(skinGain).toBeLessThan(greenGain - 0.15);
});

test("develop curves apply channel curves before the master curve", async () => {
  const source = {
    w: 1,
    h: 1,
    data: new Float32Array([0.25, 0.5, 0.75]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };

  const rgb = [
    [0, 0],
    [0.5, 0.75],
    [1, 1],
  ] as [number, number][];
  const red = [
    [0, 0],
    [1, 0.5],
  ] as [number, number][];

  const developed = await applyDevelop(source, { curves: { rgb, red } });
  const channelThenMaster = await applyDevelop(await applyDevelop(source, { curves: { red } }), {
    curves: { rgb },
  });
  const masterThenChannel = await applyDevelop(await applyDevelop(source, { curves: { rgb } }), {
    curves: { red },
  });

  developed.data.forEach((sample, index) => {
    expect(sample).toBeCloseTo(channelThenMaster.data[index]!, 5);
  });
  expect(developed.data[0]).not.toBeCloseTo(masterThenChannel.data[0]!, 4);
});

test("develop levels map black, midpoint, and white without clipping extended samples", async () => {
  const source = {
    w: 5,
    h: 1,
    data: new Float32Array([
      -0.4, -0.4, -0.4, 0.2, 0.2, 0.2, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1.4, 1.4, 1.4,
    ]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };

  const developed = await applyDevelop(source, {
    levels: { black: 0.2, midpoint: 2, white: 0.8 },
  });

  expect(developed.data[0]).toBeCloseTo(-1, 6);
  expect(developed.data[3]).toBeCloseTo(0, 6);
  expect(developed.data[6]).toBeCloseTo(Math.SQRT1_2, 6);
  expect(developed.data[9]).toBeCloseTo(1, 6);
  expect(developed.data[12]).toBeCloseTo(Math.SQRT2, 6);
});

test("develop applies levels before curves", async () => {
  const source = {
    w: 1,
    h: 1,
    data: new Float32Array([0.35, 0.5, 0.75]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const levels = { black: 0.1, midpoint: 1.4, white: 0.9 };
  const curves = {
    rgb: [
      [0, 0],
      [0.5, 0.7],
      [1, 1],
    ] as [number, number][],
  };

  const developed = await applyDevelop(source, { levels, curves });
  const levelsThenCurves = await applyDevelop(await applyDevelop(source, { levels }), { curves });
  const curvesThenLevels = await applyDevelop(await applyDevelop(source, { curves }), { levels });

  developed.data.forEach((sample, index) => {
    expect(sample).toBeCloseTo(levelsThenCurves.data[index]!, 5);
  });
  expect(developed.data[0]).not.toBeCloseTo(curvesThenLevels.data[0]!, 4);
});

test("masked and curve controls cross the canonical artifact worker seam in fixed order", async () => {
  const source = {
    w: 3,
    h: 1,
    data: new Float32Array([0.02, 0.02, 0.02, 0.5, 0.3, 0.2, 1.2, 1.2, 1.2]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const parameters = {
    highlights: -30,
    shadows: 25,
    vibrance: 40,
    levels: { black: 0.05, midpoint: 1.1, white: 0.95 },
    curves: {
      rgb: [
        [0, 0],
        [0.5, 0.6],
        [1, 1],
      ] as [number, number][],
    },
  };

  const memory = await applyDevelop(source, parameters);
  const artifact = await applyDevelopArtifact(
    await encodeArtifactLinearTiff(source),
    { w: source.w, h: source.h },
    parameters,
  );
  const decoded = await decodeArtifactLinearTiff(artifact.bytes);

  expect(decoded.data).toEqual(memory.data);
});

test("local contrast controls cross the canonical artifact seam in fixed order", async () => {
  const width = 33;
  const source = {
    w: width,
    h: 1,
    data: Float32Array.from({ length: width * 3 }, (_, index) => {
      const x = Math.floor(index / 3);
      const channel = index % 3;
      const luminance = x === 16 ? 0.85 : 0.12 + x * 0.01;
      return luminance * [1, 0.8, 0.6][channel]!;
    }),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const parameters = { brilliance: 35, definition: 45, sharpen: 55 };

  const memory = await applyDevelop(source, parameters);
  const artifact = await applyDevelopArtifact(
    await encodeArtifactLinearTiff(source),
    { w: source.w, h: source.h },
    parameters,
  );
  const decoded = await decodeArtifactLinearTiff(artifact.bytes);

  expect(decoded.data).toEqual(memory.data);
  expect(memory.data).not.toEqual(source.data);
});

test("local contrast output is byte-deterministic", async () => {
  const source = {
    w: 17,
    h: 5,
    data: Float32Array.from({ length: 17 * 5 * 3 }, (_, index) => ((index * 17) % 101) / 100),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const parameters = { brilliance: -20, definition: 30, sharpen: 70 };

  const first = await applyDevelopArtifact(
    await encodeArtifactLinearTiff(source),
    { w: source.w, h: source.h },
    parameters,
  );
  const second = await applyDevelopArtifact(
    await encodeArtifactLinearTiff(source),
    { w: source.w, h: source.h },
    parameters,
  );

  expect(second.bytes).toEqual(first.bytes);
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

test("full-frame local grading leaves the JavaScript event loop responsive", async () => {
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
    await applyDevelopArtifact(
      bytes,
      { w: width, h: height },
      { brilliance: 20, definition: 20, sharpen: 20 },
    );
  } finally {
    clearInterval(timer);
  }

  expect(heartbeats).toBeGreaterThan(2);
});
