import type { MaskImage } from "../mask-tiff.js";

/** Strict fill copies the selection; only the compositor protects unmasked pixels. */
export function strictEffectiveMask(mask: MaskImage): MaskImage {
  return { ...mask, data: new Float32Array(mask.data) };
}
