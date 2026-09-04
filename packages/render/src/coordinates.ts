export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type Point = [x: number, y: number];
export type Bbox = [x: number, y: number, w: number, h: number];

export interface Dimensions {
  w: number;
  h: number;
}

export interface OrientationTransform {
  rotation: 0 | 90 | 180 | 270;
  flip: boolean;
  flop: boolean;
}

export function parseExifOrientation(value: number): ExifOrientation {
  if (Number.isInteger(value) && value >= 1 && value <= 8) return value as ExifOrientation;
  throw new Error(`Invalid EXIF orientation: ${value}`);
}

const inverseOrientations: Record<ExifOrientation, ExifOrientation> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 8,
  7: 7,
  8: 6,
};

export function orientationTransform(orientation: ExifOrientation): OrientationTransform {
  switch (orientation) {
    case 1:
      return { rotation: 0, flip: false, flop: false };
    case 2:
      return { rotation: 0, flip: false, flop: true };
    case 3:
      return { rotation: 180, flip: false, flop: false };
    case 4:
      return { rotation: 0, flip: true, flop: false };
    case 5:
      return { rotation: 90, flip: true, flop: false };
    case 6:
      return { rotation: 90, flip: false, flop: false };
    case 7:
      return { rotation: 90, flip: false, flop: true };
    case 8:
      return { rotation: 270, flip: false, flop: false };
  }
}

export function orientedDimensions(source: Dimensions, orientation: ExifOrientation): Dimensions {
  return orientation >= 5 ? { w: source.h, h: source.w } : { ...source };
}

/**
 * Maps an un-oriented source point into the oriented, uncropped base coordinate space.
 * Points describe image edges, so the source's bottom-right edge is `[w, h]`.
 */
export function toBase(point: Point, source: Dimensions, orientation: ExifOrientation): Point {
  const transform = orientationTransform(orientation);
  let [x, y] = point;
  if (transform.flip) y = source.h - y;
  if (transform.flop) x = source.w - x;
  switch (transform.rotation) {
    case 0:
      return [x, y];
    case 90:
      return [source.h - y, x];
    case 180:
      return [source.w - x, source.h - y];
    case 270:
      return [y, source.w - x];
  }
}

/** Maps an oriented, uncropped base edge point back into the un-oriented source. */
export function fromBase([x, y]: Point, source: Dimensions, orientation: ExifOrientation): Point {
  return toBase([x, y], orientedDimensions(source, orientation), inverseOrientations[orientation]);
}

export function toBaseBbox(bbox: Bbox, source: Dimensions, orientation: ExifOrientation): Bbox {
  return transformBbox(bbox, (point) => toBase(point, source, orientation));
}

export function fromBaseBbox(bbox: Bbox, source: Dimensions, orientation: ExifOrientation): Bbox {
  return transformBbox(bbox, (point) => fromBase(point, source, orientation));
}

function transformBbox(bbox: Bbox, transform: (point: Point) => Point): Bbox {
  const [x, y, w, h] = bbox;
  const corners = [
    transform([x, y]),
    transform([x + w, y]),
    transform([x, y + h]),
    transform([x + w, y + h]),
  ];
  const xs = corners.map(([cornerX]) => cornerX);
  const ys = corners.map(([, cornerY]) => cornerY);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return [left, top, Math.max(...xs) - left, Math.max(...ys) - top];
}
