export interface DevelopStats {
  p02: number;
  p50: number;
  p98: number;
  clipped_lo_pct: number;
  clipped_hi_pct: number;
  mean_sat: number;
  est_wb_k: number;
}

const D65_CCT_K = 6504;

/** Measures encoded-sRGB saturation and linear-light Rec.709/gray-world statistics. */
export function measureDevelopStats(image: {
  pixels: Uint8Array;
  w: number;
  h: number;
  channels: 3 | 4;
}): DevelopStats {
  const count = image.w * image.h;
  if (count <= 0 || image.pixels.length !== count * image.channels) {
    throw new Error("Develop stats require complete non-empty RGB pixels");
  }
  const luminance = new Float64Array(count);
  let clippedLow = 0;
  let clippedHigh = 0;
  let saturation = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * image.channels;
    const encodedRed = image.pixels[offset]! / 255;
    const encodedGreen = image.pixels[offset + 1]! / 255;
    const encodedBlue = image.pixels[offset + 2]! / 255;
    const r = linearSrgb(encodedRed);
    const g = linearSrgb(encodedGreen);
    const b = linearSrgb(encodedBlue);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luminance[index] = y;
    if (y === 0) clippedLow += 1;
    if (y === 1) clippedHigh += 1;
    const maximum = Math.max(encodedRed, encodedGreen, encodedBlue);
    saturation +=
      maximum === 0 ? 0 : (maximum - Math.min(encodedRed, encodedGreen, encodedBlue)) / maximum;
    red += r;
    green += g;
    blue += b;
  }
  luminance.sort();
  return {
    p02: percentile(luminance, 0.02),
    p50: percentile(luminance, 0.5),
    p98: percentile(luminance, 0.98),
    clipped_lo_pct: (clippedLow / count) * 100,
    clipped_hi_pct: (clippedHigh / count) * 100,
    mean_sat: saturation / count,
    est_wb_k: estimateWhiteBalance(red / count, green / count, blue / count),
  };
}

function percentile(sorted: Float64Array, quantile: number): number {
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return (
    sorted[lower]! + (sorted[Math.min(lower + 1, sorted.length - 1)]! - sorted[lower]!) * fraction
  );
}

/** McCamy correlated color temperature over the gray-world mean chromaticity. */
function estimateWhiteBalance(red: number, green: number, blue: number): number {
  const xValue = red * 0.4124 + green * 0.3576 + blue * 0.1805;
  const yValue = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const zValue = red * 0.0193 + green * 0.1192 + blue * 0.9505;
  const sum = xValue + yValue + zValue;
  if (sum === 0) return D65_CCT_K;
  const x = xValue / sum;
  const y = yValue / sum;
  const n = (x - 0.332) / (y - 0.1858);
  const kelvin = -449 * n ** 3 + 3525 * n ** 2 - 6823.3 * n + 5520.33;
  return Math.round(Math.max(1_000, Math.min(40_000, kelvin)));
}

function linearSrgb(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
