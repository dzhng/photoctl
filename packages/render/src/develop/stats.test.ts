import { describe, expect, test } from "vitest";
import { measureDevelopStats } from "./stats.js";

describe("measureDevelopStats", () => {
  test("measures Rec.709 luminance percentiles, clipping, and saturation", () => {
    const pixels = new Uint8Array(100 * 3);
    for (let index = 0; index < 100; index += 1) {
      pixels.set([index, index, index], index * 3);
    }

    const stats = measureDevelopStats({ pixels, w: 10, h: 10, channels: 3 });
    expect(stats.p02).toBeCloseTo(0.0006009834274266982, 15);
    expect(stats.p50).toBeCloseTo(0.03130473840300258, 15);
    expect(stats.p98).toBeCloseTo(0.11959043487317073, 15);
    expect(stats.clipped_lo_pct).toBe(1);
    expect(stats.clipped_hi_pct).toBe(0);
    expect(stats.mean_sat).toBe(0);
    expect(stats.est_wb_k).toBe(6504);
  });

  test("ignores alpha and averages HSV saturation in sRGB", () => {
    expect(
      measureDevelopStats({
        pixels: Uint8Array.from([255, 0, 0, 7, 128, 128, 128, 255]),
        w: 2,
        h: 1,
        channels: 4,
      }),
    ).toMatchObject({ mean_sat: 0.5 });
  });
});
