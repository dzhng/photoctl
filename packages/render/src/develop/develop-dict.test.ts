import { expect, test, vi } from "vitest";
import {
  applyDevelopMutation,
  applyDevelopCompensation,
  canonicalDevelopJson,
  classifyDevelopChange,
  DEVELOP_OPERATORS,
  DEVELOP_TIERS,
  developDictSchema,
  developHash,
  loadPreset,
  planDevelopChange,
} from "../index.js";

test("a preset is resolved before absolute set values and provenance does not affect the hash", async () => {
  const people = (await loadPreset("people")).develop;
  const state = applyDevelopMutation(
    {},
    {
      preset: { name: "people", develop: people },
      set: ["exposure=0.3", "highlights=-12"],
    },
  );

  expect(state).toEqual({
    preset: "people",
    highlights: -12,
    shadows: 15,
    contrast: -8,
    vibrance: 10,
    saturation: -5,
    white_balance: { temp_offset_k: 150 },
    noise_reduction: { luminance: 15, color: 25 },
    sharpen: 20,
    definition: -5,
    vignette: -8,
    exposure: 0.3,
  });
  expect(developHash(state)).toBe(developHash({ ...state, preset: "another-name" }));
  expect(developHash(state)).toMatch(/^h_[0-9a-f]{64}$/);
});

test("canonical hashing ignores insertion order but changes with resolved adjustment values", () => {
  const first = { contrast: 8, white_balance: { tint: -2, temp_offset_k: 120 } };
  const reordered = { white_balance: { temp_offset_k: 120, tint: -2 }, contrast: 8 };

  expect(canonicalDevelopJson(first)).toBe(
    '{"contrast":8,"white_balance":{"temp_offset_k":120,"tint":-2}}',
  );
  expect(developHash(first)).toBe(developHash(reordered));
  expect(developHash({ ...first, contrast: 9 })).not.toBe(developHash(first));
});

test("canonical nested key order does not depend on host locale collation", () => {
  const localeCompare = vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => {
    throw new Error("locale collation must not define persisted hashes");
  });
  try {
    expect(
      canonicalDevelopJson({
        white_balance: { tint: 2, temp_offset_k: 100 },
        noise_reduction: { luminance: 4, color: 3 },
      }),
    ).toBe(
      '{"noise_reduction":{"color":3,"luminance":4},"white_balance":{"temp_offset_k":100,"tint":2}}',
    );
  } finally {
    localeCompare.mockRestore();
  }
});

test("the operator table classifies only small white-balance and cheap global changes as Tier 1", () => {
  expect(DEVELOP_OPERATORS.exposure).toMatchObject({
    range: [-5, 5],
    operator: "grading_primary",
    tier: 1,
  });
  expect(classifyDevelopChange({}, { exposure: 1, contrast: 5 })).toBe(1);
  expect(classifyDevelopChange({}, { white_balance: { temp_offset_k: 300 } })).toBe(1);
  expect(classifyDevelopChange({}, { white_balance: { temp_offset_k: 301 } })).toBe(2);
  expect(classifyDevelopChange({}, { highlights: -1 })).toBe(2);
  expect(classifyDevelopChange({}, {})).toBeNull();
  expect(
    planDevelopChange(
      { exposure: -0.25, white_balance: { temp_offset_k: -100 } },
      { exposure: 0.5, white_balance: { temp_offset_k: 100 } },
    ),
  ).toEqual({ tier: 2, compensations: null });
  expect(planDevelopChange({ exposure: -5 }, { exposure: 5 })).toEqual({
    tier: 1,
    compensations: [{ exposure: 5 }, { exposure: 5 }],
  });
  const saturation = planDevelopChange({ saturation: 50 }, { saturation: 100 });
  expect(saturation?.tier).toBe(1);
  expect(saturation?.compensations?.[0]?.saturation).toBeCloseTo(100 / 3);
  const wideSaturation = planDevelopChange({ saturation: -50 }, { saturation: 100 });
  expect(wideSaturation?.tier).toBe(1);
  if (wideSaturation?.tier === 1) {
    const advanced = wideSaturation.compensations.reduce(applyDevelopCompensation, {
      saturation: -50,
    });
    expect(advanced.saturation).toBeCloseTo(100);
  }
  expect(planDevelopChange({ saturation: -100 }, { saturation: 0 })).toEqual({
    tier: 2,
    compensations: null,
  });
  expect(planDevelopChange({ exposure: 1, contrast: 5 }, { exposure: 2, contrast: 5 })).toEqual({
    tier: 2,
    compensations: null,
  });
});

test("unknown keys and out-of-range values are rejected instead of entering canonical state", () => {
  expect(() => applyDevelopMutation({}, { set: ["unknown=1"] })).toThrow(
    "Unknown develop key: unknown",
  );
  expect(() => applyDevelopMutation({}, { unset: ["constructor"] })).toThrow(
    "Unknown develop key: constructor",
  );
  expect(() => applyDevelopMutation({}, { set: ["filter.strength=2"] })).toThrow();
  expect(() => applyDevelopMutation({}, { set: ["rotate=45"] })).toThrow();
  expect(() => applyDevelopMutation({}, { set: ["aspect_ratio=0:3"] })).toThrow();
  expect(() => applyDevelopMutation({}, { set: ["aspect_ratio=3:0"] })).toThrow();
  expect(() =>
    applyDevelopMutation(
      {},
      {
        set: ['curves={"rgb":[[0,0],[0.5,0.8],[1,0.7]]}'],
      },
    ),
  ).toThrow("curve output coordinates must be non-decreasing");
});

test("bundled preset lookup ignores inherited object properties", async () => {
  await expect(loadPreset("constructor")).rejects.toThrow("Preset not found: constructor");
});

test("the canonical dictionary accepts every named adjustment in one resolved state", () => {
  const state = {
    brilliance: 1,
    exposure: 0.5,
    highlights: -2,
    shadows: 3,
    brightness: 4,
    contrast: 5,
    black_point: 6,
    saturation: 7,
    vibrance: 8,
    cast: 9,
    white_balance: { temp_offset_k: 200, tint: -3 },
    curves: {
      rgb: [
        [0, 0],
        [1, 1],
      ],
    },
    levels: { black: 0.01, midpoint: 1, white: 0.99 },
    definition: 10,
    selective_color: { orange: { hue: 1, saturation: 2, luminance: 3 } },
    noise_reduction: { luminance: 11, color: 12 },
    sharpen: 13,
    vignette: -14,
    bw: { intensity: 15, neutrals: -16, tone: 17, grain: 18 },
    crop: { x: 1, y: 2, w: 30, h: 40 },
    rotate: 90 as const,
    straighten_deg: 1.5,
    aspect_ratio: "3:2",
    filter: { name: "vivid_warm" as const, strength: 0.4 },
  };

  expect(developDictSchema.parse(state)).toEqual(state);
});

test("the tier table has exactly the cheap global and white-balance paths in Tier 1", () => {
  expect(
    Object.entries(DEVELOP_TIERS)
      .filter(([, tier]) => tier === 1)
      .map(([key]) => key)
      .toSorted(),
  ).toEqual(
    [
      "black_point",
      "brightness",
      "contrast",
      "exposure",
      "saturation",
      "vibrance",
      "white_balance.temp_offset_k",
      "white_balance.tint",
    ].toSorted(),
  );
});

test("selective color accepts a partial set of hue bands", () => {
  expect(applyDevelopMutation({}, { set: ['selective_color={"red":{"hue":1}}'] })).toEqual({
    selective_color: { red: { hue: 1 } },
  });
});

test("a preset overlays matching values while preserving unrelated and nested current values", async () => {
  const people = (await loadPreset("people")).develop;

  const state = applyDevelopMutation(
    { exposure: 2, cast: 30, white_balance: { temp_offset_k: -50, tint: 12 } },
    { preset: { name: "people", develop: people } },
  );

  expect(state).toMatchObject({
    preset: "people",
    exposure: 2,
    cast: 30,
    highlights: -20,
    contrast: -8,
    white_balance: { temp_offset_k: 150, tint: 12 },
  });
});
