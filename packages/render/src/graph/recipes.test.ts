import { expect, test } from "vitest";
import {
  canonicalNodeRecipe,
  deterministicExecutionId,
  evaluationHash,
  imageNodeRegistry,
  logicalNodeId,
  newExecutionId,
  recipeHash,
  renderHashForNode,
} from "./recipes.js";

test("logical recipes canonicalize parameters but preserve ordered node inputs", () => {
  const inputs = [`node_${"1".repeat(64)}`, `node_${"2".repeat(64)}`];
  const first = canonicalNodeRecipe({
    kind: "composite",
    recipeVersion: 1,
    parameters: { opacity: 1, blend: "normal" },
    inputNodeIds: inputs,
  });
  const reorderedParameters = canonicalNodeRecipe({
    kind: "composite",
    recipeVersion: 1,
    parameters: { blend: "normal", opacity: 1 },
    inputNodeIds: inputs,
  });
  const reorderedInputs = canonicalNodeRecipe({
    kind: "composite",
    recipeVersion: 1,
    parameters: { opacity: 1, blend: "normal" },
    inputNodeIds: inputs.toReversed(),
  });
  const recipe = recipeHash(first);
  const node = logicalNodeId(recipe);

  expect(first).toBe(reorderedParameters);
  expect(first).not.toBe(reorderedInputs);
  expect(recipe).toMatch(/^recipe_[0-9a-f]{64}$/);
  expect(node).toMatch(/^node_[0-9a-f]{64}$/);
  expect(renderHashForNode(node)).toMatch(/^r_[0-9a-f]{64}$/);
  expect(() =>
    canonicalNodeRecipe({
      kind: "crop",
      recipeVersion: 1,
      parameters: { x: 0, y: 0, w: 10, h: 10, mystery: true },
      inputNodeIds: [inputs[0]],
    }),
  ).toThrow("Unrecognized key");
  expect(Object.keys(imageNodeRegistry)).toHaveLength(11);
});

test("logical recipes reject a version their node kind does not support", () => {
  expect(() =>
    canonicalNodeRecipe({
      kind: "source",
      recipeVersion: 2,
      parameters: { orientation: 1 },
      inputNodeIds: [],
    }),
  ).toThrow("source does not support recipe version 2");
});

test("evaluation identity binds actual artifacts while deterministic execution is reusable", () => {
  const common = {
    nodeRecipeHash: `recipe_${"1".repeat(64)}`,
    kind: "develop" as const,
    recipeVersion: 1,
  };
  const first = evaluationHash({ ...common, inputArtifactHashes: [`a_${"2".repeat(64)}`] });
  const second = evaluationHash({ ...common, inputArtifactHashes: [`a_${"3".repeat(64)}`] });

  expect(first).not.toBe(second);
  expect(deterministicExecutionId(first)).toBe(deterministicExecutionId(first));
  expect(deterministicExecutionId(first)).toMatch(/^exec_[0-9a-f]{64}$/);
  expect(newExecutionId()).not.toBe(newExecutionId());
  expect(newExecutionId()).toMatch(/^exec_[0-9a-f]{64}$/);
  expect(() =>
    evaluationHash({ ...common, recipeVersion: 2, inputArtifactHashes: [`a_${"2".repeat(64)}`] }),
  ).toThrow("develop does not support recipe version 2");
});

test("source evaluation requires actual source provenance", () => {
  expect(() =>
    evaluationHash({
      nodeRecipeHash: `recipe_${"1".repeat(64)}`,
      kind: "source",
      recipeVersion: 1,
      inputArtifactHashes: [],
    }),
  ).toThrow("Source evaluation requires source provenance");
});

test("non-source evaluation refuses source provenance", () => {
  expect(() =>
    evaluationHash({
      nodeRecipeHash: `recipe_${"1".repeat(64)}`,
      kind: "develop",
      recipeVersion: 1,
      inputArtifactHashes: [`a_${"2".repeat(64)}`],
      source: {
        locator: { kind: "pinned-preview", cache_path: "emb/photo.jpg" },
        tier: "pinned-preview",
        w: 1616,
        h: 1077,
        decoderId: "sharp",
        decoderVersion: "0.35.4",
        outputArtifactHash: `a_${"4".repeat(64)}`,
      },
    }),
  ).toThrow("Source provenance is only valid for source evaluation");
});

test("source fallback changes evaluation identity without changing logical render state", () => {
  const recipe = recipeHash(
    canonicalNodeRecipe({
      kind: "source",
      recipeVersion: 1,
      parameters: { orientation: 1 },
      inputNodeIds: [],
    }),
  );
  const node = logicalNodeId(recipe);
  const common = {
    nodeRecipeHash: recipe,
    kind: "source" as const,
    recipeVersion: 1,
    inputArtifactHashes: [],
  };
  const full = evaluationHash({
    ...common,
    source: {
      locator: { kind: "online-file", volume_uuid: "camera", rel_path: "frame.ARW" },
      tier: "online-file",
      w: 7008,
      h: 4672,
      decoderId: "libraw",
      decoderVersion: "0.22.2",
      outputArtifactHash: `a_${"4".repeat(64)}`,
    },
  });
  const fallback = evaluationHash({
    ...common,
    source: {
      locator: { kind: "pinned-preview", cache_path: "emb/photo.jpg" },
      tier: "pinned-preview",
      w: 1616,
      h: 1077,
      decoderId: "sharp",
      decoderVersion: "0.35.4",
      outputArtifactHash: `a_${"4".repeat(64)}`,
    },
  });

  expect(full).not.toBe(fallback);
  expect(
    evaluationHash({
      ...common,
      source: {
        locator: { kind: "online-file", volume_uuid: "camera", rel_path: "frame.ARW" },
        tier: "online-file",
        w: 7008,
        h: 4672,
        decoderId: "libraw",
        decoderVersion: "0.22.2",
        outputArtifactHash: `a_${"5".repeat(64)}`,
      },
    }),
  ).not.toBe(full);
  expect(renderHashForNode(node)).toBe(renderHashForNode(node));
});
