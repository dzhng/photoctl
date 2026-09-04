import type { ExifOrientation } from "./coordinates.js";
import { FileImageDecoder, type ImageSource } from "./decoder.js";

export interface RenderPhoto {
  orientation: ExifOrientation;
}

export interface Image16 {
  w: number;
  h: number;
  channels: 3;
  data: Uint16Array;
  space: "display-srgb";
  orientationApplied: true;
}

export async function renderPhoto(photo: RenderPhoto, source: ImageSource): Promise<Image16> {
  const orientation = source.kind === "pinned-preview" ? source.orientation : photo.orientation;
  const image = await new FileImageDecoder().decodeDisplay(source, { scale: 1, orientation });
  return {
    w: image.w,
    h: image.h,
    channels: 3,
    data: image.data,
    space: "display-srgb",
    orientationApplied: true,
  };
}
