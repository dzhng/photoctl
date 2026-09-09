import { initializeLibrary } from "@photoctl/library";
import { segmentDataSchema } from "@photoctl/protocol";
import {
  createMaskLayers,
  loadActiveDocument,
  readArtifactMask,
  artifactPath,
  evaluateGraphNode,
  loadBaseProjection,
  commitRevision,
} from "@photoctl/render";
import { rasterFrame, savedRenderFrame } from "../../render/src/graph/frame.js";
import { transformMaskPixels } from "@photoctl/img";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test("manual addition corrects the same selection and preserves soft coverage and other layers", async () => {
  const fixture = await selectionFixture();
  try {
    const before = await loadActiveDocument(fixture.handle, fixture.id);
    const result = segmentDataSchema.parse(
      await fixture.command(["--layer", fixture.layerId, "--operation", "add", "--box", "2,0,1,2"]),
    );
    expect(result.layer_id).toBe(fixture.layerId);
    expect(result.mask).toMatchObject({ bbox: [0, 0, 3, 2], pixels: 6 });
    expect(Array.from((await fixture.mask(result.mask.artifact_hash)).data)).toEqual([
      0.25, 1, 1, 0, 0.5, 1, 1, 0, 0, 0, 0, 0,
    ]);
    const after = await loadActiveDocument(fixture.handle, fixture.id);
    expect(after!.layers[0]).toEqual({
      ...before!.layers[0],
      maskNodeId: after!.layers[0].maskNodeId,
    });
    expect(after!.layers[1]).toEqual(before!.layers[1]);
    expect(Array.from((await fixture.mask(fixture.originalHash)).data)).toEqual(fixture.original);
  } finally {
    await fixture.close();
  }
});

test("subtract-all saves an empty selection which normalized polygon replacement and addition can refill", async () => {
  const fixture = await selectionFixture();
  try {
    const cleared = segmentDataSchema.parse(
      await fixture.command([
        "--layer",
        fixture.layerId,
        "--operation",
        "subtract",
        "--box",
        "0,0,4,3",
      ]),
    );
    expect(cleared.mask).toMatchObject({ bbox: [0, 0, 0, 0], pixels: 0 });
    expect(Array.from((await fixture.mask(cleared.mask.artifact_hash)).data)).toEqual(
      Array.from({ length: 12 }, () => 0),
    );
    const replaced = segmentDataSchema.parse(
      await fixture.command([
        "--layer",
        fixture.layerId,
        "--operation",
        "replace",
        "--norm",
        "--brush",
        "[[0.5,0],[1,0],[1,1],[0.5,1]]",
      ]),
    );
    expect(replaced.layer_id).toBe(fixture.layerId);
    expect(Array.from((await fixture.mask(replaced.mask.artifact_hash)).data)).toEqual([
      0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1,
    ]);
    const added = segmentDataSchema.parse(
      await fixture.command([
        "--layer",
        fixture.layerId,
        "--operation",
        "add",
        "--norm",
        "--box",
        "0,0,0.25,1",
      ]),
    );
    expect(Array.from((await fixture.mask(added.mask.artifact_hash)).data)).toEqual([
      1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1,
    ]);
  } finally {
    await fixture.close();
  }
});

test("correction uses base coordinates after movement and crop, and subsequent movement retains mask alignment", async () => {
  const fixture = await selectionFixture();
  try {
    await fixture.other("layer", [
      "transform",
      fixture.id,
      fixture.layerId,
      "--dx",
      "1",
      "--anchor",
      "0,0",
    ]);
    await fixture.other("crop", [fixture.id, "--aspect", "1:1", "--straighten", "10"]);
    const before = await loadActiveDocument(fixture.handle, fixture.id);
    await fixture.command([
      "--layer",
      fixture.layerId,
      "--operation",
      "subtract",
      "--box",
      "1,0,1,3",
    ]);
    expect(await fixture.baseCoverage()).toEqual([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    const after = await loadActiveDocument(fixture.handle, fixture.id);
    expect(after!.layers[0].contentNodeId).toBe(before!.layers[0].contentNodeId);
    expect(after!.roots.geometry).toBe(before!.roots.geometry);
    await fixture.other("layer", [
      "transform",
      fixture.id,
      fixture.layerId,
      "--dx",
      "1",
      "--relative",
      "--anchor",
      "0,0",
    ]);
    expect(await fixture.baseCoverage()).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]);
    const replacement = segmentDataSchema.parse(
      await fixture.command([
        "--layer",
        fixture.layerId,
        "--operation",
        "replace",
        "--box",
        "2,0,1,2",
      ]),
    );
    expect(replacement.mask.bbox).toEqual([2, 0, 1, 2]);
    expect(await fixture.baseCoverage()).toEqual([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    await fixture.other("layer", [
      "transform",
      fixture.id,
      fixture.layerId,
      "--dx",
      "1",
      "--anchor",
      "0,0",
    ]);
    expect(await fixture.baseCoverage()).toEqual([0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  } finally {
    await fixture.close();
  }
});

test("an empty selection can be placed with an explicit anchor and refilled at its scaled base coordinates", async () => {
  const fixture = await selectionFixture();
  try {
    await fixture.command([
      "--layer",
      fixture.layerId,
      "--operation",
      "subtract",
      "--box",
      "0,0,4,3",
    ]);
    await fixture.other("layer", [
      "transform",
      fixture.id,
      fixture.layerId,
      "--scale",
      "2",
      "--anchor",
      "0,0",
    ]);
    const refilled = segmentDataSchema.parse(
      await fixture.command([
        "--layer",
        fixture.layerId,
        "--operation",
        "replace",
        "--box",
        "2,0,2,2",
      ]),
    );
    expect(refilled.mask).toMatchObject({ bbox: [2, 0, 2, 2], pixels: 1 });
    expect(Array.from((await fixture.mask(refilled.mask.artifact_hash)).data)).toEqual([
      0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  } finally {
    await fixture.close();
  }
});

test("addition respects retained content support without erasing untouched selection coverage", async () => {
  const fixture = await selectionFixture();
  try {
    const before = (await loadActiveDocument(fixture.handle, fixture.id))!;
    await commitRevision(fixture.handle, {
      photoId: fixture.id,
      expectedRevisionId: before.revisionId,
      outputPlan: "photographic",
      rootUpdates: [],
      nodes: [
        {
          localKey: "small-content",
          kind: "solid",
          recipeVersion: 1,
          parameters: { w: 2, h: 2, space: "scene-linear-rec2020", rgb: [0.2, 0.4, 0.6] },
          inputs: [],
        },
        {
          localKey: "placed-content",
          kind: "transform",
          recipeVersion: 2,
          parameters: {
            matrix: [1, 0, 0, 1, 0, 0],
            frame: savedRenderFrame(
              rasterFrame({ w: 4, h: 3 }, { w: 4, h: 3 }, { w: 2, h: 2 }, [1, 0, 0, 1, -1, 0]),
            ),
          },
          inputs: [{ localKey: "small-content" }],
        },
      ],
      layers: before.layers.map((layer, index) => ({
        layer: { layerId: layer.id },
        name: layer.name,
        z: layer.z,
        contentNode: index === 0 ? { localKey: "placed-content" } : { nodeId: layer.contentNodeId },
        maskNode: { nodeId: layer.maskNodeId },
        opacity: layer.opacity,
        blend: layer.blend,
        enabled: layer.enabled,
      })),
    });
    const added = segmentDataSchema.parse(
      await fixture.command(["--layer", fixture.layerId, "--operation", "add", "--box", "0,0,4,3"]),
    );
    expect(Array.from((await fixture.mask(added.mask.artifact_hash)).data)).toEqual([
      0.25, 1, 1, 0, 0.5, 1, 1, 0, 0, 0, 0, 0,
    ]);
    const replaced = segmentDataSchema.parse(
      await fixture.command([
        "--layer",
        fixture.layerId,
        "--operation",
        "replace",
        "--box",
        "0,0,4,3",
      ]),
    );
    expect(Array.from((await fixture.mask(replaced.mask.artifact_hash)).data)).toEqual([
      0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0,
    ]);
  } finally {
    await fixture.close();
  }
});

test("invalid refinement and missing or inactive targets leave saved selection state untouched", async () => {
  const fixture = await selectionFixture();
  try {
    const before = await loadActiveDocument(fixture.handle, fixture.id);
    await Promise.all(
      [
        ["--layer", fixture.layerId, "--box", "0,0,1,1"],
        ["--operation", "add", "--box", "0,0,1,1"],
        ["--layer", "", "--operation", "add", "--box", "0,0,1,1"],
        ["--layer", fixture.layerId, "--operation", "intersect", "--box", "0,0,1,1"],
        ["--layer", fixture.layerId, "--operation", "add", "--at", "1,1"],
        ["--layer", fixture.layerId, "--operation", "add", "--box", "0,0,1,1", "--text", "person"],
        [
          "--layer",
          fixture.layerId,
          "--operation",
          "add",
          "--box",
          "0,0,1,1",
          "--brush",
          "[[0,0],[1,0],[0,1]]",
        ],
        ["--layer", fixture.layerId, "--operation", "add", "--box", "0,0,1,1", "--dry-run"],
      ].map(async (args) =>
        expect(await fixture.raw("segment", [fixture.id, ...args])).toMatchObject({
          ok: false,
          code: "usage",
        }),
      ),
    );
    expect(
      await fixture.raw("segment", [
        fixture.id,
        "--layer",
        "ffffffff",
        "--operation",
        "add",
        "--box",
        "0,0,1,1",
      ]),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(await loadActiveDocument(fixture.handle, fixture.id)).toEqual(before);
    await fixture.other("layer", ["remove", fixture.id, fixture.layerId]);
    const removed = await loadActiveDocument(fixture.handle, fixture.id);
    expect(
      await fixture.raw("segment", [
        fixture.id,
        "--layer",
        fixture.layerId,
        "--operation",
        "add",
        "--box",
        "0,0,1,1",
      ]),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(await loadActiveDocument(fixture.handle, fixture.id)).toEqual(removed);
  } finally {
    await fixture.close();
  }
});

test("a concurrent edit wins over an in-flight refinement without losing either saved mask", async () => {
  const fixture = await selectionFixture();
  const query = fixture.handle.query;
  let winner: Awaited<ReturnType<typeof loadActiveDocument>> | undefined;
  try {
    fixture.handle.query = (async (...args: Parameters<typeof query>) => {
      if (args[0].includes("FROM node_executions") && !winner) {
        fixture.handle.query = query;
        await fixture.other("layer", [
          "set",
          fixture.id,
          fixture.layerId,
          "--name",
          "Concurrent rename",
        ]);
        winner = await loadActiveDocument(fixture.handle, fixture.id);
      }
      return await query(...args);
    }) as typeof query;
    const result = await fixture.raw("segment", [
      fixture.id,
      "--layer",
      fixture.layerId,
      "--operation",
      "replace",
      "--box",
      "2,0,1,1",
    ]);
    expect(result).toMatchObject({
      ok: false,
      code: "library_locked",
      data: { reason: "revision_conflict" },
    });
    expect(winner!.layers[0].name).toBe("Concurrent rename");
    expect(await loadActiveDocument(fixture.handle, fixture.id)).toEqual(winner);
    expect(Array.from((await fixture.mask(fixture.originalHash)).data)).toEqual(fixture.original);
  } finally {
    fixture.handle.query = query;
    await fixture.close();
  }
});

async function selectionFixture() {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-refinement-"));
  const { handle } = await initializeLibrary(join(directory, "library"));
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c171";
  await handle.query(
    `WITH seed (id, content_key, size, w, h, orientation) AS (VALUES ($1, $2, 1, 4, 3, 1)), inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation) SELECT id::uuid, id::uuid, w::integer, h::integer, orientation::integer FROM seed RETURNING id) INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation) SELECT id::uuid, id::uuid, 'image', content_key, size::bigint, w::integer, h::integer, orientation::integer FROM seed`,
    [id, "ck_refinement00000"],
  );
  const original = [0.25, 1, 0, 0, 0.5, 1, 0, 0, 0, 0, 0, 0];
  const created = await createMaskLayers(handle, handle.path, {
    photoId: id,
    orientation: 1,
    layers: [
      { name: "SAM subject", mask: { w: 4, h: 3, data: new Float32Array(original) } },
      { name: "Other selection", mask: { w: 4, h: 3, data: new Float32Array(12).fill(1) } },
    ],
  });
  const raw = (verb: string, args: string[]) =>
    dispatch(
      { verb, args, cwd: directory, env: { noDaemon: true } },
      {
        version: "test",
        library: handle,
        segmentation: {
          local: {
            segment: async () => {
              throw new Error("Refinement must not invoke SAM");
            },
          },
        },
      },
    );
  const other = async (verb: string, args: string[]) => {
    const response = await raw(verb, args);
    expect(response, JSON.stringify(response)).toMatchObject({ ok: true });
    if (!response.ok || !("data" in response)) throw new Error("Expected command data");
    return response.data;
  };
  return {
    directory,
    handle,
    id,
    original,
    layerId: created.layers[0].layerId,
    originalHash: created.layers[0].artifactHash,
    mask: (hash: string) => readArtifactMask(artifactPath(handle.path, hash, "tif"), hash),
    command: (args: string[]) => other("segment", [id, ...args]),
    other,
    raw,
    baseCoverage: async () => {
      const active = await loadActiveDocument(handle, id);
      const evaluated = await evaluateGraphNode({
        database: handle,
        libraryPath: handle.path,
        photoId: id,
        nodeId: active!.layers[0].maskNodeId,
      });
      const frame = await loadBaseProjection(handle, id, evaluated);
      const mask = await readArtifactMask(evaluated.artifact.path, evaluated.artifact.artifactHash);
      return Array.from(
        await transformMaskPixels(mask.data, mask.w, mask.h, 4, 3, frame.rasterToBase),
      );
    },
    close: async () => {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
