import { expect, test } from "vitest";
import { reciprocalRankFusion } from "./rrf.js";

test("RRF at k=60 rewards an item found by both independent search arms", () => {
  expect(
    reciprocalRankFusion([
      ["text-only", "both"],
      ["vector-only", "both"],
    ]),
  ).toEqual([
    { id: "both", score: 2 / 62, sources: ["text", "vector"] },
    { id: "text-only", score: 1 / 61, sources: ["text"] },
    { id: "vector-only", score: 1 / 61, sources: ["vector"] },
  ]);
});

test("RRF breaks equal-score ties by photo id rather than arm order", () => {
  expect(reciprocalRankFusion([["z-photo"], ["a-photo"]])).toEqual([
    { id: "a-photo", score: 1 / 61, sources: ["vector"] },
    { id: "z-photo", score: 1 / 61, sources: ["text"] },
  ]);
});
