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

test("develop crops base pixels before an exact clockwise quarter-turn", async () => {
  const source = {
    w: 4,
    h: 3,
    data: new Float32Array(
      [0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23].flatMap((sample) => [sample, sample, sample]),
    ),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };

  const developed = await applyDevelop(source, {
    crop: { x: 1, y: 0, w: 2, h: 3 },
    rotate: 90,
  });

  expect({ w: developed.w, h: developed.h }).toEqual({ w: 3, h: 2 });
  expect(Array.from(developed.data).filter((_, index) => index % 3 === 0)).toEqual([
    21, 11, 1, 22, 12, 2,
  ]);
});

test.each([
  [0, { w: 3, h: 2 }, [0, 1, 2, 10, 11, 12]],
  [90, { w: 2, h: 3 }, [10, 0, 11, 1, 12, 2]],
  [180, { w: 3, h: 2 }, [12, 11, 10, 2, 1, 0]],
  [270, { w: 2, h: 3 }, [2, 12, 1, 11, 0, 10]],
] as const)(
  "develop rotate=%i preserves exact asymmetric pixels",
  async (rotate, dims, expected) => {
    const source = {
      w: 3,
      h: 2,
      data: new Float32Array([0, 1, 2, 10, 11, 12].flatMap((sample) => [sample, sample, sample])),
      space: "scene-linear-rec2020" as const,
      orientationApplied: true as const,
      whiteLevel: 1,
      blackLevel: 0,
      wbPreApplied: true,
    };

    const developed = await applyDevelop(source, { rotate });

    expect({ w: developed.w, h: developed.h }).toEqual(dims);
    expect(Array.from(developed.data).filter((_, index) => index % 3 === 0)).toEqual(expected);
  },
);

test("develop straightens the already-cropped and quarter-turned frame", async () => {
  const source = {
    w: 4,
    h: 3,
    data: new Float32Array(
      [0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23].flatMap((sample) => [sample, sample, sample]),
    ),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const croppedAndRotated = await applyDevelop(source, {
    crop: { x: 1, y: 0, w: 2, h: 3 },
    rotate: 90,
  });

  const combined = await applyDevelop(source, {
    crop: { x: 1, y: 0, w: 2, h: 3 },
    rotate: 90,
    straighten_deg: 7,
  });
  const sequential = await applyDevelop(croppedAndRotated, { straighten_deg: 7 });

  expect({ w: combined.w, h: combined.h }).toEqual({ w: sequential.w, h: sequential.h });
  combined.data.forEach((sample, index) => {
    expect(sample).toBeCloseTo(sequential.data[index]!, 6);
  });
});

test("develop trims the empty corners from a straightened frame", async () => {
  const source = {
    w: 100,
    h: 80,
    data: new Float32Array(100 * 80 * 3).fill(0.5),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };

  const developed = await applyDevelop(source, { straighten_deg: 10 });

  expect(developed.w).toBeLessThan(source.w);
  expect(developed.h).toBeLessThan(source.h);
  expect(Math.min(...developed.data)).toBeGreaterThan(0.45);
});

test("develop applies an aspect constraint inside the base-space crop", async () => {
  const source = {
    w: 6,
    h: 4,
    data: new Float32Array(
      [
        0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25, 30, 31, 32, 33, 34, 35,
      ].flatMap((sample) => [sample, sample, sample]),
    ),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };

  const developed = await applyDevelop(source, {
    crop: { x: 1, y: 0, w: 4, h: 4 },
    aspect_ratio: "2:1",
  });

  expect({ w: developed.w, h: developed.h }).toEqual({ w: 4, h: 2 });
  expect(Array.from(developed.data).filter((_, index) => index % 3 === 0)).toEqual([
    11, 12, 13, 14, 21, 22, 23, 24,
  ]);
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

test("noise reduction crosses the canonical artifact seam in fixed order", async () => {
  const source = {
    w: 7,
    h: 5,
    data: Float32Array.from({ length: 7 * 5 * 3 }, (_, index) => {
      const pixel = Math.floor(index / 3);
      const channel = index % 3;
      const base = 0.12 + (pixel % 7) * 0.015;
      const noise = pixel === 17 ? [0.08, -0.04, 0.06][channel]! : 0;
      return base * [1, 0.85, 0.7][channel]! + noise;
    }),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const parameters = {
    sharpen: 20,
    noise_reduction: { luminance: 65, color: 80 },
  };

  const memory = await applyDevelop(source, parameters);
  const artifact = await applyDevelopArtifact(
    await encodeArtifactLinearTiff(source),
    { w: source.w, h: source.h },
    parameters,
  );
  const repeatedArtifact = await applyDevelopArtifact(
    await encodeArtifactLinearTiff(source),
    { w: source.w, h: source.h },
    parameters,
  );
  const decoded = await decodeArtifactLinearTiff(artifact.bytes);
  const sharpened = await applyDevelop(source, { sharpen: 20 });
  const ordered = await applyDevelop(sharpened, {
    noise_reduction: { luminance: 65, color: 80 },
  });

  expect(decoded.data).toEqual(memory.data);
  expect(repeatedArtifact.bytes).toEqual(artifact.bytes);
  expect(memory.data).toEqual(ordered.data);
  expect(memory.data).not.toEqual(source.data);
});

test.each([
  "vivid",
  "vivid_warm",
  "vivid_cool",
  "dramatic",
  "dramatic_warm",
  "dramatic_cool",
  "mono",
  "silvertone",
  "noir",
] as const)("filter %s is deterministic native recipe data", async (name) => {
  const source = {
    w: 2,
    h: 1,
    data: new Float32Array([0.08, 0.24, 0.62, 0.9, 0.36, 0.12]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const parameters = { filter: { name, strength: 1 } };

  const first = await applyDevelop(source, parameters);
  const second = await applyDevelop(source, parameters);

  expect(first.data).toEqual(second.data);
  expect(first.data).not.toEqual(source.data);
  expect(Array.from(first.data).every(Number.isFinite)).toBe(true);
});

test("filter strength linearly blends with the unfiltered develop result", async () => {
  const source = {
    w: 1,
    h: 1,
    data: new Float32Array([0.12, 0.35, 0.7]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const unfiltered = await applyDevelop(source, { exposure: 0.5, definition: 20 });
  const full = await applyDevelop(source, {
    exposure: 0.5,
    definition: 20,
    filter: { name: "vivid_warm", strength: 1 },
  });
  const half = await applyDevelop(source, {
    exposure: 0.5,
    definition: 20,
    filter: { name: "vivid_warm", strength: 0.5 },
  });
  const zero = await applyDevelop(source, {
    exposure: 0.5,
    definition: 20,
    filter: { name: "vivid_warm", strength: 0 },
  });

  expect(zero.data).toEqual(unfiltered.data);
  half.data.forEach((sample, index) => {
    expect(sample).toBeCloseTo((unfiltered.data[index]! + full.data[index]!) / 2, 6);
  });
});

test("B&W controls produce deterministic monochrome tone and grain", async () => {
  const source = {
    w: 3,
    h: 2,
    data: new Float32Array([
      0.05, 0.2, 0.7, 0.8, 0.35, 0.12, 0.3, 0.65, 0.18, 0.9, 0.75, 0.2, 0.04, 0.08, 0.15, 0.5, 0.22,
      0.6,
    ]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const neutral = await applyDevelop(source, { bw: { intensity: 0 } });
  const tuned = await applyDevelop(source, {
    bw: { intensity: 65, neutrals: -25, tone: 40, grain: 55 },
  });
  const repeated = await applyDevelop(source, {
    bw: { intensity: 65, neutrals: -25, tone: 40, grain: 55 },
  });

  neutral.data.forEach((sample, index) => {
    expect(sample).toBeCloseTo(neutral.data[index - (index % 3)]!, 6);
  });
  expect(tuned.data).toEqual(repeated.data);
  expect(tuned.data).not.toEqual(neutral.data);
  expect(new Set(Array.from(tuned.data).map((sample) => sample.toFixed(6))).size).toBeGreaterThan(
    3,
  );
});

test.each([
  ["intensity", { intensity: 50 }],
  ["neutrals", { neutrals: 50 }],
  ["tone", { tone: 50 }],
  ["grain", { grain: 50 }],
] as const)("B&W %s independently changes the neutral monochrome grade", async (_name, bw) => {
  const source = {
    w: 2,
    h: 2,
    data: new Float32Array([0.05, 0.2, 0.7, 0.8, 0.35, 0.12, 0.3, 0.65, 0.18, 0.9, 0.75, 0.2]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const neutral = await applyDevelop(source, { bw: { intensity: 0 } });
  const adjusted = await applyDevelop(source, { bw });

  expect(adjusted.data).not.toEqual(neutral.data);
  adjusted.data.forEach((sample, index) => {
    expect(sample).toBeCloseTo(adjusted.data[index - (index % 3)]!, 6);
  });
});

test("filters and B&W cross the canonical seam before geometry", async () => {
  const source = {
    w: 3,
    h: 2,
    data: new Float32Array([
      0.1, 0.2, 0.7, 0.8, 0.3, 0.1, 0.2, 0.6, 0.35, 0.7, 0.5, 0.15, 0.05, 0.15, 0.4, 0.4, 0.25, 0.8,
    ]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const pixelParameters = {
    bw: { intensity: 20, neutrals: 10, tone: -15, grain: 0 },
    filter: { name: "silvertone" as const, strength: 0.7 },
  };
  const combined = await applyDevelop(source, { ...pixelParameters, rotate: 90 });
  const sequential = await applyDevelop(await applyDevelop(source, pixelParameters), {
    rotate: 90,
  });
  const artifact = await applyDevelopArtifact(
    await encodeArtifactLinearTiff(source),
    { w: source.w, h: source.h },
    { ...pixelParameters, rotate: 90 },
  );
  const decoded = await decodeArtifactLinearTiff(artifact.bytes);

  expect({ w: combined.w, h: combined.h }).toEqual({ w: 2, h: 3 });
  expect(combined.data).toEqual(sequential.data);
  expect(decoded.data).toEqual(combined.data);
});

test("zero noise reduction is an exact canonical no-op", async () => {
  const source = {
    w: 3,
    h: 2,
    data: new Float32Array([
      -0.1, 0.2, 1.4, 0.1, 0.11, 0.12, 0.8, 0.4, 0.2, 0.3, 0.2, 0.1, 1.2, 1.1, 1, 0.03, 0.04, 0.05,
    ]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const input = await encodeArtifactLinearTiff(source);

  const output = await applyDevelopArtifact(
    input,
    { w: source.w, h: source.h },
    { noise_reduction: { luminance: 0, color: 0 } },
  );

  expect(output.bytes).toEqual(input);
});

test("noise reduction leaves the JavaScript event loop responsive", async () => {
  const width = 128;
  const height = 96;
  const bytes = await encodeArtifactLinearTiff({
    w: width,
    h: height,
    data: Float32Array.from(
      { length: width * height * 3 },
      (_, index) => 0.2 + ((index * 17) % 19) * 0.0005,
    ),
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
      { noise_reduction: { luminance: 50, color: 50 } },
    );
  } finally {
    clearInterval(timer);
  }

  expect(heartbeats).toBeGreaterThan(2);
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

test("canonical develop artifacts apply geometry after pixel grading", async () => {
  const source = {
    w: 4,
    h: 2,
    data: new Float32Array(
      [0, 1, 2, 3, 10, 11, 12, 13].flatMap((sample) => [sample, sample, sample]),
    ),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const bytes = await encodeArtifactLinearTiff(source);

  const developed = await applyDevelopArtifact(
    bytes,
    { w: 4, h: 2 },
    {
      exposure: 1,
      crop: { x: 1, y: 0, w: 3, h: 2 },
      rotate: 90,
    },
  );

  expect({ w: developed.w, h: developed.h }).toEqual({ w: 2, h: 3 });
  const decoded = await decodeArtifactLinearTiff(developed.bytes);
  expect(Array.from(decoded.data).filter((_, index) => index % 3 === 0)).toEqual([
    22, 2, 24, 4, 26, 6,
  ]);
});

test("canonical geometry scales base-space crops for lower-resolution source artifacts", async () => {
  const bytes = await encodeArtifactLinearTiff({
    w: 4,
    h: 2,
    data: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8].flatMap((sample) => [sample, sample, sample])),
    space: "scene-linear-rec2020",
    orientationApplied: true,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  });

  const developed = await applyDevelopArtifact(
    bytes,
    { w: 4, h: 2 },
    { crop: { x: 2, y: 0, w: 4, h: 4 } },
    { w: 8, h: 4 },
  );
  const decoded = await decodeArtifactLinearTiff(developed.bytes);

  expect({ w: decoded.w, h: decoded.h }).toEqual({ w: 2, h: 2 });
  expect(Array.from(decoded.data).filter((_, index) => index % 3 === 0)).toEqual([2, 3, 6, 7]);
});

test("canonical geometry leaves the JavaScript event loop responsive", async () => {
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
    await applyDevelopArtifact(bytes, { w: width, h: height }, { straighten_deg: 10 });
  } finally {
    clearInterval(timer);
  }

  expect(heartbeats).toBeGreaterThan(2);
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
