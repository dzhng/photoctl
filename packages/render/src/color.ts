import { fileURLToPath } from "node:url";

/** ICC's unmodified sRGB2014 profile bundled for deterministic preview tagging. */
export const srgb2014ProfilePath = fileURLToPath(
  new URL("../assets/sRGB2014.icc", import.meta.url),
);

export function displaySrgbToLinearRec2020(samples: Uint16Array): Float32Array {
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 3) {
    const red = inverseSrgb(samples[index] / 65_535);
    const green = inverseSrgb(samples[index + 1] / 65_535);
    const blue = inverseSrgb(samples[index + 2] / 65_535);
    output[index] = 0.627404 * red + 0.329283 * green + 0.043313 * blue;
    output[index + 1] = 0.069097 * red + 0.91954 * green + 0.011362 * blue;
    output[index + 2] = 0.016391 * red + 0.088013 * green + 0.895595 * blue;
  }
  return output;
}

function inverseSrgb(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
