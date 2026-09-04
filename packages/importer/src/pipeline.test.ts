import { expect, test } from "vitest";
import { consumeBoundedOrdered } from "./pipeline.js";

test("the import pipeline bounds retained results and commits in scan order", async () => {
  let active = 0;
  let highWater = 0;
  let retained = 0;
  let retainedHighWater = 0;
  const committed: number[] = [];
  await consumeBoundedOrdered(
    [30, 1, 20, 0],
    2,
    async (value) => {
      active += 1;
      highWater = Math.max(highWater, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      retained += 1;
      retainedHighWater = Math.max(retainedHighWater, retained);
      return value;
    },
    async (value) => {
      committed.push(value);
      retained -= 1;
    },
  );

  expect(highWater).toBe(2);
  expect(retainedHighWater).toBeLessThanOrEqual(2);
  expect(committed).toEqual([30, 1, 20, 0]);
  expect(retained).toBe(0);
});
