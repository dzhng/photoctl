import type { ExifOrientation } from "./coordinates.js";
import { displaySrgbToLinearRec2020, toSceneLinearRec2020 } from "./color.js";
import { FileImageDecoder, type ImageSource, type LinearImage } from "./decoder.js";
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

/** Converts a native decoder result to the canonical oriented scene-linear buffer. */
export async function renderLinearSource(decoded: LinearImage): Promise<LinearImage> {
  return await toSceneLinearRec2020(decoded);
}

export async function renderSourceExecution(
  orientation: ExifOrientation,
  source: ImageSource,
  locator: SourceExecutionProvenance["locator"],
): Promise<{ image: LinearImage; provenance: SourceExecutionProvenance }> {
  if (source.kind !== locator.kind) throw new Error("Source bytes and provenance locator disagree");
  const display = await renderSource(orientation, source);
  const image: LinearImage = {
    w: display.w,
    h: display.h,
    orientationApplied: true,
    space: "scene-linear-rec2020",
    data: await displaySrgbToLinearRec2020(display.data),
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
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
