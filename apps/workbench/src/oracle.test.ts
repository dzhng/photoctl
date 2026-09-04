import { expect, test } from "vitest";
import { deltaE00, measureOracleFrames } from "./oracle.js";

test("CIEDE2000 agrees with the published Sharma reference pair", () => {
  expect(deltaE00([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
});

test("oracle reports zero distance for identical 64x64 patch grids", () => {
  const data = new Float32Array(64 * 64 * 3).fill(0.18);
  const verdict = measureOracleFrames(
    { width: 64, height: 64, data },
    { width: 64, height: 64, data: data.slice() },
  );

  expect(verdict).toEqual({
    compared: 4096,
    excluded: 0,
    meanDeltaE00: 0,
    p95DeltaE00: 0,
    passed: true,
  });
});

test("oracle refuses unequal frames instead of resizing them into agreement", () => {
  expect(() =>
    measureOracleFrames(
      { width: 64, height: 65, data: new Float32Array(64 * 65 * 3) },
      { width: 65, height: 64, data: new Float32Array(65 * 64 * 3) },
    ),
  ).toThrow("same framing");
});

test("oracle excludes clipped patches from its numeric verdict", () => {
  const reference = new Float32Array(64 * 64 * 3).fill(1);
  const candidate = new Float32Array(64 * 64 * 3).fill(0);
  expect(
    measureOracleFrames(
      { width: 64, height: 64, data: reference },
      { width: 64, height: 64, data: candidate },
    ),
  ).toEqual({ compared: 0, excluded: 4096, meanDeltaE00: null, p95DeltaE00: null, passed: false });
});
