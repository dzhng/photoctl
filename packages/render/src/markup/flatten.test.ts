import { expect, test } from "vitest";
import { drawMarkup } from "./flatten.js";

test("an opaque rectangle changes covered pixels and preserves every outside sample bit-exactly", async () => {
  const w = 12;
  const h = 9;
  const input = Float32Array.from({ length: w * h * 3 }, (_, index) => (index % 31) / 37);
  const output = await drawMarkup(
    { w, h, data: input },
    [
      {
        id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c170",
        type: "rect",
        bbox: [3, 2, 5, 4],
        width: 1,
        color: "#ff0000",
        fill: "#ff0000",
      },
    ],
    { baseW: w, baseH: h, matrix: [1, 0, 0, 1, 0, 0] },
  );

  let changedInside = 0;
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const inside = x >= 3 && x < 8 && y >= 2 && y < 6;
      for (let channel = 0; channel < 3; channel += 1) {
        const index = (y * w + x) * 3 + channel;
        if (inside) {
          if (output.data[index] !== input[index]) changedInside += 1;
        } else {
          expect(output.data[index]).toBe(input[index]);
        }
      }
    }
  expect(changedInside).toBeGreaterThan(0);
});

test("base-space markup follows crop geometry into output space", async () => {
  const output = await drawMarkup(
    { w: 4, h: 4, data: new Float32Array(4 * 4 * 3) },
    [
      {
        id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c171",
        type: "rect",
        bbox: [3, 3, 2, 2],
        width: 1,
        color: "#ffffff",
        fill: "#ffffff",
      },
    ],
    { baseW: 8, baseH: 8, matrix: [1, 0, 0, 1, -2, -2] },
  );

  expect(Math.max(...output.data)).toBeGreaterThan(0.5);
  for (let channel = 0; channel < 3; channel += 1) {
    expect(output.data[channel]).toBe(0);
  }
});
