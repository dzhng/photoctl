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
  expect(() =>
    canonicalNodeRecipe({
      kind: "develop",
      recipeVersion: 1,
      parameters: { exposure: 6 },
      inputNodeIds: [inputs[0]],
    }),
  ).toThrow();
  expect(Object.keys(imageNodeRegistry)).toHaveLength(14);
});

test("solid RGB is an explicit deterministic zero-input recipe", () => {
  expect(
    canonicalNodeRecipe({
      kind: "solid",
      recipeVersion: 1,
      parameters: {
        w: 40,
        h: 30,
        space: "scene-linear-rec2020",
        rgb: [1, 0, 1],
      },
      inputNodeIds: [],
    }),
  ).toBe(
    '{"input_node_ids":[],"kind":"solid","parameters":{"h":30,"rgb":[1,0,1],"space":"scene-linear-rec2020","w":40},"recipe_version":1}',
  );
});

test("resample v2 binds one affine placement into an oriented output canvas", () => {
  const input = `node_${"1".repeat(64)}`;
  expect(
    canonicalNodeRecipe({
      kind: "resample",
      recipeVersion: 2,
      parameters: {
        w: 40,
        h: 30,
        kernel: "lanczos3",
        matrix: [2, 0, 0, 2, 8, 6],
      },
      inputNodeIds: [input],
    }),
  ).toBe(
    `{"input_node_ids":["${input}"],"kind":"resample","parameters":{"h":30,"kernel":"lanczos3","matrix":[2,0,0,2,8,6],"w":40},"recipe_version":2}`,
  );
});

test.each([
  ["five values", [1, 0, 0, 1, 0]],
  ["a non-finite value", [1, 0, 0, 1, 0, Number.POSITIVE_INFINITY]],
  ["a singular transform", [1, 0, 0, 0, 0, 0]],
  ["a transform whose inverse overflows", [Number.MIN_VALUE, 0, 0, 1, 0, 0]],
])("resample v2 rejects %s in its affine matrix", (_label, matrix) => {
  expect(() =>
    canonicalNodeRecipe({
      kind: "resample",
      recipeVersion: 2,
      parameters: { w: 2, h: 2, kernel: "lanczos3", matrix },
      inputNodeIds: [`node_${"1".repeat(64)}`],
    }),
  ).toThrow();
});

test("composite v2 binds ordered content-mask pairs to aligned pixel parameters", () => {
  const base = `node_${"1".repeat(64)}`;
  const content = `node_${"2".repeat(64)}`;
  const mask = `node_${"3".repeat(64)}`;
  const recipe = canonicalNodeRecipe({
    kind: "composite",
    recipeVersion: 2,
    parameters: { layers: [{ opacity: 0.5, blend: "normal" }] },
    inputNodeIds: [base, content, mask],
  });

  expect(recipe).toContain('"recipe_version":2');
  expect(() =>
    canonicalNodeRecipe({
      kind: "composite",
      recipeVersion: 2,
      parameters: { layers: [{ opacity: 0.5, blend: "normal" }] },
      inputNodeIds: [base, mask, content, mask, content],
    }),
  ).toThrow("one content/mask pair per layer");
  expect(() =>
    canonicalNodeRecipe({
      kind: "composite",
      recipeVersion: 1,
      parameters: { opacity: 1, blend: "normal" },
      inputNodeIds: [base],
    }),
  ).toThrow("at least two inputs");
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

test("an upscaler adapter version is part of immutable recipe identity", () => {
  const input = `node_${"1".repeat(64)}`;
  const recipe = (adapterVersion: string) =>
    recipeHash(
      canonicalNodeRecipe({
        kind: "upscale",
        recipeVersion: 1,
        parameters: {
          adapter: "purpose-built",
          adapter_version: adapterVersion,
          model: "vendor/model",
          model_version: null,
          scale: 2,
          controls: {},
          request: { execution_id: `exec_${"2".repeat(64)}` },
        },
        inputNodeIds: [input],
      }),
    );

  expect(recipe("1")).not.toBe(recipe("2"));
});

test("external node recipes reject moving symbolic model ids", () => {
  expect(() =>
    canonicalNodeRecipe({
      kind: "upscale",
      recipeVersion: 1,
      parameters: {
        adapter: "purpose-built",
        adapter_version: "1",
        model: "vendor/latest",
        model_version: null,
        scale: 2,
        controls: {},
        request: { execution_id: `exec_${"2".repeat(64)}` },
      },
      inputNodeIds: [`node_${"1".repeat(64)}`],
    }),
  ).toThrow();
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
