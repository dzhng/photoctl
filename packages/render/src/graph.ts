import sharp, { type Sharp } from "sharp";
import { orientationTransform, type ExifOrientation } from "./coordinates.js";
import { readImageSource, type ImageSource } from "./decoder.js";

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
  const bytes = await readImageSource(source);
  const orientation = source.kind === "pinned-preview" ? source.orientation : photo.orientation;
  const pipeline = orient(sharp(bytes, { failOn: "error" }), orientation)
    .toColourspace("rgb16")
    .removeAlpha()
    .raw({ depth: "ushort" });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    w: info.width,
    h: info.height,
    channels: 3,
    data: new Uint16Array(
      data.buffer,
      data.byteOffset,
      data.byteLength / Uint16Array.BYTES_PER_ELEMENT,
    ),
    space: "display-srgb",
    orientationApplied: true,
  };
}

function orient(pipeline: Sharp, orientation: ExifOrientation): Sharp {
  const transform = orientationTransform(orientation);
  let oriented = pipeline;
  if (transform.flip) oriented = oriented.flip();
  if (transform.flop) oriented = oriented.flop();
  return transform.rotation === 0 ? oriented : oriented.rotate(transform.rotation);
}
