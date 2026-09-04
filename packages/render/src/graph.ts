import sharp, { type Sharp } from "sharp";
import { orientationTransform, type ExifOrientation } from "./coordinates.js";

export interface RenderPhoto {
  orientation: ExifOrientation;
}

export interface EmbeddedRenderSource {
  source: "embedded";
  bytes: Uint8Array;
}

export interface Image16 {
  w: number;
  h: number;
  channels: 3;
  data: Uint16Array;
  space: "display-srgb";
  orientationApplied: true;
}

export async function renderPhoto(
  photo: RenderPhoto,
  input: EmbeddedRenderSource,
): Promise<Image16> {
  const pipeline = orient(sharp(input.bytes, { failOn: "error" }), photo.orientation)
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
