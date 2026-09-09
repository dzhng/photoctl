import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("full-resolution ZIM preparation does not expand pixel samples into the JavaScript heap", () => {
  // A small heap distinguishes typed pixel buffers from a temporary boxed sample list;
  // this subprocess setting is not a production memory budget.
  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=128",
      "--input-type=module",
      "-e",
      `
        import { prepareZimEncoderInput } from ${JSON.stringify(new URL("../dist/zim.js", import.meta.url).href)};
        const image = { w: 2048, h: 2048, data: new Float32Array(2048 * 2048 * 3).fill(0.5) };
        const prepared = prepareZimEncoderInput(image.data, image);
        console.log(JSON.stringify({
          dimensions: prepared.mapping.resized,
          samples: [0, 1024 * 1024, 2 * 1024 * 1024].map(i => prepared.data[i]),
        }));
      `,
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.dimensions).toEqual({ w: 1024, h: 1024 });
  expect(output.samples[0]).toBeCloseTo((128 - 123.675) / 58.395, 6);
  expect(output.samples[1]).toBeCloseTo((128 - 116.28) / 57.12, 6);
  expect(output.samples[2]).toBeCloseTo((128 - 103.53) / 57.375, 6);
});

test("text grounding reduces full-resolution pixels without a boxed sample list", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=128",
      "--input-type=module",
      "-e",
      `
        import { segmentationGroundingPixels } from ${JSON.stringify(new URL("../dist/segmentation-frame.js", import.meta.url).href)};
        const image = { w: 2048, h: 2048, data: new Float32Array(2048 * 2048 * 3).fill(0.5) };
        const pixels = segmentationGroundingPixels(image);
        console.log(JSON.stringify({ w: pixels.w, h: pixels.h, first: [...pixels.data.subarray(0, 3)], last: [...pixels.data.subarray(-3)] }));
      `,
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    w: 1024,
    h: 1024,
    first: [128, 128, 128],
    last: [128, 128, 128],
  });
});
