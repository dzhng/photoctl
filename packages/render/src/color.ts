import { fileURLToPath } from "node:url";
import {
  developCameraFront,
  displaySrgbToLinearRec2020 as convertDisplaySrgb,
  linearRec2020ToDisplaySrgb as convertLinearRec2020,
  type NativeLinearImage,
} from "@photoctl/img";
import type { LinearImage } from "./decoder.js";

/** ICC's unmodified sRGB2014 profile bundled for deterministic preview tagging. */
export const srgb2014ProfilePath = fileURLToPath(
  new URL("../assets/sRGB2014.icc", import.meta.url),
);

/** ICC v4.4 matrix/TRC profile for already-linear Rec.2020 TIFF samples. */
export const linearRec2020ProfilePath = fileURLToPath(
  new URL("../assets/LinearRec2020-v4.icc", import.meta.url),
);

export async function displaySrgbToLinearRec2020(samples: Uint16Array): Promise<Float32Array> {
  return await convertDisplaySrgb(samples);
}

export async function linearRec2020ToDisplaySrgb(samples: Float32Array): Promise<Float32Array> {
  return await convertLinearRec2020(samples);
}

export async function toSceneLinearRec2020(image: LinearImage): Promise<LinearImage> {
  if (image.space === "scene-linear-rec2020") return image;
  if (!image.camXyz || !image.asShotWb) {
    throw new Error("Camera-space images require cam_xyz and as-shot WB metadata");
  }
  const developed = await developCameraFront({
    width: image.w,
    height: image.h,
    space: "camera",
    data: image.data,
    whiteLevel: image.whiteLevel,
    blackLevel: image.blackLevel,
    camXyz: [...image.camXyz],
    asShotWb: [...image.asShotWb],
    wbPreApplied: image.wbPreApplied,
  } satisfies NativeLinearImage);
  return {
    w: image.w,
    h: image.h,
    orientationApplied: true,
    ...developed,
  };
}
