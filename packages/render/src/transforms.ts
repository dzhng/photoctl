export type TransformMatrix = readonly [number, number, number, number, number, number];
export interface TransformPoint {
  x: number;
  y: number;
}
export interface Transform {
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
  flip: "h" | "v" | "both" | null;
  anchor: TransformPoint | "centroid";
}

export function matrixForTransform(
  transform: Transform,
  centroid?: TransformPoint,
): TransformMatrix {
  const anchor = transform.anchor === "centroid" ? centroid : transform.anchor;
  if (!anchor) throw new Error("A centroid-anchored transform requires the mask centroid");
  for (const value of [
    transform.dx,
    transform.dy,
    transform.scale,
    transform.rotate,
    anchor.x,
    anchor.y,
  ]) {
    if (!Number.isFinite(value)) throw new Error("Transform values must be finite");
  }
  if (transform.scale <= 0) throw new Error("Transform scale must be positive");

  const radians = (transform.rotate * Math.PI) / 180;
  const cosine = snapTrig(Math.cos(radians));
  const sine = snapTrig(Math.sin(radians));
  const scaleX = transform.scale * (transform.flip === "h" || transform.flip === "both" ? -1 : 1);
  const scaleY = transform.scale * (transform.flip === "v" || transform.flip === "both" ? -1 : 1);
  const a = cleanZero(cosine * scaleX);
  const b = cleanZero(sine * scaleX);
  const c = cleanZero(-sine * scaleY);
  const d = cleanZero(cosine * scaleY);
  return [
    a,
    b,
    c,
    d,
    cleanZero(anchor.x + transform.dx - a * anchor.x - c * anchor.y),
    cleanZero(anchor.y + transform.dy - b * anchor.x - d * anchor.y),
  ];
}

export function resolveTransformMatrix(
  current: TransformMatrix,
  request: Transform,
  relative: boolean,
  centroid?: TransformPoint,
): TransformMatrix {
  const requested = matrixForTransform(request, centroid);
  return relative ? composeTransformMatrices(requested, current) : requested;
}

export function composeTransformMatrices(
  left: TransformMatrix,
  right: TransformMatrix,
): TransformMatrix {
  return [
    cleanZero(left[0] * right[0] + left[2] * right[1]),
    cleanZero(left[1] * right[0] + left[3] * right[1]),
    cleanZero(left[0] * right[2] + left[2] * right[3]),
    cleanZero(left[1] * right[2] + left[3] * right[3]),
    cleanZero(left[0] * right[4] + left[2] * right[5] + left[4]),
    cleanZero(left[1] * right[4] + left[3] * right[5] + left[5]),
  ];
}

export function invertTransformMatrix(matrix: TransformMatrix): TransformMatrix {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (determinant === 0 || !Number.isFinite(determinant)) {
    throw new Error("Transform matrix must have a finite inverse");
  }
  return [
    matrix[3] / determinant,
    -matrix[1] / determinant,
    -matrix[2] / determinant,
    matrix[0] / determinant,
    (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
    (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant,
  ];
}

export function transformPoint(matrix: TransformMatrix, point: TransformPoint): TransformPoint {
  return {
    x: cleanZero(matrix[0] * point.x + matrix[2] * point.y + matrix[4]),
    y: cleanZero(matrix[1] * point.x + matrix[3] * point.y + matrix[5]),
  };
}

function snapTrig(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 1) < 1e-12) return 1;
  if (Math.abs(value + 1) < 1e-12) return -1;
  return value;
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
