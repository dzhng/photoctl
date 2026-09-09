import type { ImageModelAdapter, PreparedImageEdit } from "@photoctl/providers";
import { PhotoctlError } from "@photoctl/protocol";
import { cropMappedExternalImage } from "../fill/external-pixels.js";

export async function normalizeGeneratedImage(
  adapter: Pick<ImageModelAdapter, "normalize">,
  response: unknown,
  prepared: Pick<PreparedImageEdit, "outputDimensions" | "frameMapping">,
  capture: (bytes: Buffer) => Promise<void>,
) {
  const normalized = await adapter.normalize(response, prepared.outputDimensions, capture);
  if (!prepared.frameMapping) return normalized;
  if (
    normalized.returnedDimensions.w !== prepared.outputDimensions.w ||
    normalized.returnedDimensions.h !== prepared.outputDimensions.h
  )
    throw new PhotoctlError(
      "provider_whole_frame",
      "The provider returned a different canvas than the declared frame mapping",
      {
        requested: prepared.outputDimensions,
        returned: normalized.returnedDimensions,
      },
    );
  const output = prepared.frameMapping.output;
  return {
    ...normalized,
    png: await cropMappedExternalImage(normalized.png, output),
    returnedDimensions: { w: output[2], h: output[3] },
  };
}
