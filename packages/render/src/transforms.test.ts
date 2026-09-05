import { expect, test } from "vitest";
import { matrixForTransform, resolveTransformMatrix, transformPoint } from "./transforms.js";

test("an asymmetric base-space transform applies scale then rotation then translation", () => {
  const request = {
    dx: 10,
    dy: 20,
    scale: 2,
    rotate: 90,
    flip: null,
    anchor: { x: 0, y: 0 },
  } as const;
  const matrix = matrixForTransform(request);

  expect(
    [
      [0, 0],
      [2, 0],
      [0, 3],
    ].map(([x, y]) => transformPoint(matrix, { x, y })),
  ).toEqual([
    { x: 10, y: 20 },
    { x: 10, y: 24 },
    { x: 4, y: 20 },
  ]);
  expect(resolveTransformMatrix(matrix, request, false)).toEqual(matrix);
  expect(resolveTransformMatrix(matrix, request, true)).not.toEqual(matrix);
  expect(transformPoint(resolveTransformMatrix(matrix, request, true), { x: 2, y: 3 })).toEqual(
    transformPoint(matrix, transformPoint(matrix, { x: 2, y: 3 })),
  );
});
