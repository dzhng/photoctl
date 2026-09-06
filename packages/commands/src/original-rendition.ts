import { PhotoctlError } from "@photoctl/protocol";
import { orientedDimensions, renderHashForOriginal } from "@photoctl/render";
import type { StoredPhoto } from "./photo.js";

export function cameraJpegRendition(photo: StoredPhoto): {
  photo: StoredPhoto;
  renderHash: `r_${string}`;
} {
  const candidates = photo.originals.filter((original) => original.kind === "jpeg");
  if (candidates.length !== 1)
    throw new PhotoctlError("usage", "Photo does not have exactly one camera JPEG original", {
      id: photo.id,
    });
  const original = candidates[0];
  return {
    photo: {
      ...photo,
      primaryOriginalId: original.id,
      ...orientedDimensions(original, original.orientation),
      orientation: original.orientation,
      camera: original.camera,
      exposure: original.exposure,
      shotAt: original.shotAt,
      shotOffsetMin: original.shotOffsetMin,
    },
    renderHash: renderHashForOriginal(original),
  };
}
