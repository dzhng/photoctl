import type { ExifOrientation } from "./coordinates.js";
import { FileImageDecoder, type ImageSource } from "./decoder.js";
import type { SourceExecutionProvenance } from "./graph/types.js";
import sharp from "sharp";

export interface Image16 {
  w: number;
  h: number;
  channels: 3;
  data: Uint16Array;
  space: "display-srgb";
  orientationApplied: true;
}

export async function renderSource(
  orientation: ExifOrientation,
  source: ImageSource,
): Promise<Image16> {
  const appliedOrientation = source.kind === "pinned-preview" ? source.orientation : orientation;
  const image = await new FileImageDecoder().decodeDisplay(source, {
    scale: 1,
    orientation: appliedOrientation,
  });
  return {
    w: image.w,
    h: image.h,
    channels: 3,
    data: image.data,
    space: "display-srgb",
    orientationApplied: true,
  };
}

export async function renderSourceExecution(
  orientation: ExifOrientation,
  source: ImageSource,
  locator: SourceExecutionProvenance["locator"],
): Promise<{ image: Image16; provenance: SourceExecutionProvenance }> {
  if (source.kind !== locator.kind) throw new Error("Source bytes and provenance locator disagree");
  const image = await renderSource(orientation, source);
  return {
    image,
    provenance: {
      locator,
      tier: source.kind,
      w: image.w,
      h: image.h,
      decoderId: "file",
      decoderVersion: sharp.versions.sharp,
    },
  };
}
