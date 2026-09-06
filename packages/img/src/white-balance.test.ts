import { expect, test } from "vitest";
import { applyDevelopPixels, fitWhiteBalance } from "./index.js";

test("bounded neutral fitting reports residual through the same forward grade", async () => {
  await Promise.all(
    [
      [0.2, 0.2, 0.2],
      [0.18, 0.2, 0.23],
      [0.24, 0.2, 0.18],
      [0.2, 0.24, 0.2],
      [1.0, 0.1, 0.05],
    ].map(async (rgb) => {
      const fit = fitWhiteBalance(rgb);
      const result = await applyDevelopPixels(new Float32Array(rgb), 1, 1, {
        temperatureOffsetK: fit.tempOffsetK,
        tint: fit.tint,
      });
      const average = [...result].reduce((a, b) => a + b) / 3;
      const residual = Math.sqrt([...result].reduce((a, v) => a + (v / average - 1) ** 2, 0) / 3);
      expect(residual).toBeCloseTo(fit.residual, 6);
      expect(Math.abs(fit.tempOffsetK)).toBeLessThanOrEqual(1500);
      expect(Math.abs(fit.tint)).toBeLessThanOrEqual(100);
      if (!fit.limited) expect(residual).toBeLessThan(1e-6);
    }),
  );
  expect(fitWhiteBalance([1, 0.1, 0.05])).toMatchObject({ limited: true });
  expect(fitWhiteBalance([0.2, 0.2, 0.2])).toEqual({
    tempOffsetK: 0,
    tint: 0,
    limited: false,
    residual: 0,
  });
});

test("neutral fit is intensity-invariant and refuses black or invalid cone responses", () => {
  const sample = [0.18, 0.2, 0.23];
  const fit = fitWhiteBalance(sample);
  for (const scale of [0.001, 2, 100]) {
    const scaled = fitWhiteBalance(sample.map((v) => v * scale));
    expect(scaled.tempOffsetK).toBeCloseTo(fit.tempOffsetK, 3);
    expect(scaled.tint).toBeCloseTo(fit.tint, 5);
  }
  for (const invalid of [
    [0, 0, 0],
    [-0, 0, 0],
    [-1, -1, -1],
    [NaN, 1, 1],
    [Infinity, 1, 1],
  ])
    expect(() => fitWhiteBalance(invalid)).toThrow();
});
