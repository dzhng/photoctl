import { PGlite } from "@electric-sql/pglite";
import { testDatabase } from "../../../library/src/migrations/test-database.js";
import { migrate } from "../../../library/src/migrations/runner.js";
import { expect, test } from "vitest";
import {
  commitRevision,
  ensurePhotoDocument,
  loadActiveDocument,
  RevisionConflictError,
  setRevisionPinned,
  undoRevision,
} from "./store.js";
import { compositeV2Projection, resolveLayerId, type RevisionLayerDraft } from "../layers/model.js";
import { MASK_ARTIFACT_MEDIA_TYPE } from "../artifacts/publication.js";
import { canonicalNodeRecipe, evaluationHash, logicalNodeId, recipeHash } from "./recipes.js";

const firstPhoto = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
const secondPhoto = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002";

test("one revision atomically stores a chain with ordered shared inputs and redirects output", async () => {
  const db = await graphDatabase();
  try {
    const committed = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [
        source("source"),
        develop("bright", { localKey: "source" }, 1),
        develop("dark", { localKey: "source" }, -1),
        {
          localKey: "composite",
          kind: "composite",
          recipeVersion: 1,
          parameters: { opacity: 1 },
          inputs: [{ localKey: "dark" }, { localKey: "bright" }, { localKey: "dark" }],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "composite" } }],
    });

    const inputs = await db.query<{ input_index: number; input_node_id: string }>(
      `SELECT input_index, input_node_id FROM image_node_inputs
       WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index`,
      [firstPhoto, committed.nodes.composite.id],
    );
    expect(inputs.rows).toEqual([
      { input_index: 0, input_node_id: committed.nodes.dark.id },
      { input_index: 1, input_node_id: committed.nodes.bright.id },
      { input_index: 2, input_node_id: committed.nodes.dark.id },
    ]);
    expect(committed.roots).toEqual({
      base: committed.nodes.composite.id,
      output: committed.nodes.composite.id,
    });
    expect(committed.renderHash).toMatch(/^r_[0-9a-f]{64}$/);
  } finally {
    await db.close();
  }
});

test("concurrent source document initialization converges on one active revision", async () => {
  const db = await graphDatabase();
  try {
    const initialized = await Promise.all([
      ensurePhotoDocument(db, { photoId: firstPhoto, orientation: 1 }),
      ensurePhotoDocument(db, { photoId: firstPhoto, orientation: 1 }),
    ]);

    expect(initialized[0]).toEqual(initialized[1]);
    expect(
      (await db.query<{ count: string }>("SELECT count(*)::text AS count FROM document_revisions"))
        .rows,
    ).toEqual([{ count: "1" }]);
  } finally {
    await db.close();
  }
});

test("logical mutations are immutable, lazy, CAS-protected, and undoable", async () => {
  const db = await graphDatabase();
  try {
    const original = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [source("source")],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });
    const edited = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: original.revisionId,
      nodes: [develop("edit", { nodeId: original.nodes.source.id }, 1)],
      rootUpdates: [{ root: "output", node: { localKey: "edit" } }],
    });

    expect(edited.renderHash).not.toBe(original.renderHash);
    expect((await db.query("SELECT 1 FROM node_executions")).rows).toEqual([]);
    await setRevisionPinned(db, {
      photoId: firstPhoto,
      revisionId: original.revisionId,
      pinned: true,
    });
    expect(
      (
        await db.query<{ pinned: boolean }>(
          "SELECT pinned FROM document_revisions WHERE photo_id = $1 AND id = $2",
          [firstPhoto, original.revisionId],
        )
      ).rows,
    ).toEqual([{ pinned: true }]);
    const stale = commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: original.revisionId,
      nodes: [develop("stale", { nodeId: original.nodes.source.id }, 2)],
      rootUpdates: [{ root: "output", node: { localKey: "stale" } }],
    });
    await expect(stale).rejects.toThrow(RevisionConflictError);
    await expect(stale).rejects.toThrow("document changed");
    const undone = await undoRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: edited.revisionId,
    });
    expect(undone).toEqual({ revisionId: original.revisionId, renderHash: original.renderHash });
    expect(
      (await db.query<{ count: string }>("SELECT count(*)::text AS count FROM image_nodes")).rows,
    ).toEqual([{ count: "2" }]);
  } finally {
    await db.close();
  }
});

test("local cycles and cross-photo edges roll back without partial graph state", async () => {
  const db = await graphDatabase();
  try {
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [
          develop("left", { localKey: "right" }, 1),
          develop("right", { localKey: "left" }, 2),
        ],
        rootUpdates: [{ root: "output", node: { localKey: "left" } }],
      }),
    ).rejects.toThrow("cycle refused");
    expect((await db.query("SELECT 1 FROM image_nodes")).rows).toEqual([]);

    const first = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [source("source")],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });
    await expect(
      commitRevision(db, {
        photoId: secondPhoto,
        expectedRevisionId: null,
        nodes: [develop("foreign", { nodeId: first.nodes.source.id }, 1)],
        rootUpdates: [{ root: "output", node: { localKey: "foreign" } }],
      }),
    ).rejects.toThrow("does not exist for photo");
  } finally {
    await db.close();
  }
});

test("the same logical recipe is valid in two photo-scoped graphs", async () => {
  const db = await graphDatabase();
  try {
    const first = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [source("source")],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });
    const second = await commitRevision(db, {
      photoId: secondPhoto,
      expectedRevisionId: null,
      nodes: [source("source")],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });

    expect(first.nodes.source.id).toBe(second.nodes.source.id);
    const owners = await db.query<{ photo_id: string }>(
      "SELECT photo_id::text FROM image_nodes WHERE id = $1 ORDER BY photo_id",
      [first.nodes.source.id],
    );
    expect(owners.rows).toEqual([{ photo_id: firstPhoto }, { photo_id: secondPhoto }]);
  } finally {
    await db.close();
  }
});

test("revision inheritance stays in its photo when revision UUIDs repeat", async () => {
  const db = await graphDatabase();
  try {
    const first = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [source("first-source")],
      rootUpdates: [{ root: "output", node: { localKey: "first-source" } }],
    });
    const second = await commitRevision(db, {
      photoId: secondPhoto,
      expectedRevisionId: null,
      nodes: [source("second-source")],
      rootUpdates: [{ root: "output", node: { localKey: "second-source" } }],
    });
    await db.query("INSERT INTO document_revisions (id, photo_id) VALUES ($1, $2)", [
      first.revisionId,
      secondPhoto,
    ]);
    await db.query(
      `INSERT INTO document_revision_roots (revision_id, photo_id, root_name, node_id)
       VALUES ($1, $2, 'output', $3)`,
      [first.revisionId, secondPhoto, second.nodes["second-source"].id],
    );

    const edited = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: first.revisionId,
      nodes: [develop("edit", { nodeId: first.nodes["first-source"].id }, 1)],
      rootUpdates: [{ root: "output", node: { localKey: "edit" } }],
    });

    expect(edited.roots).toEqual({
      base: edited.nodes.edit.id,
      output: edited.nodes.edit.id,
    });
  } finally {
    await db.close();
  }
});

test("a paid nondeterministic ancestor cannot become active before artifact publication", async () => {
  const db = await graphDatabase();
  try {
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [
          source("source"),
          {
            localKey: "generated",
            kind: "generate",
            recipeVersion: 1,
            parameters: {
              adapter: "gateway-image-v1",
              adapter_version: "1",
              model: "paid-v1",
              model_version: null,
              prompt: "restore",
              prompt_version: 1,
              request: {},
            },
            inputs: [{ localKey: "source" }],
          },
          {
            localKey: "output",
            kind: "output",
            recipeVersion: 1,
            parameters: { format: "display-rgb", color_space: "srgb" },
            inputs: [{ localKey: "generated" }],
          },
        ],
        rootUpdates: [{ root: "output", node: { localKey: "output" } }],
      }),
    ).rejects.toThrow("before its artifact is published");
    expect((await db.query("SELECT 1 FROM image_nodes")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});

test("unreachable drafts and node-only revisions are refused without debris", async () => {
  const db = await graphDatabase();
  try {
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [source("source"), develop("orphan", { localKey: "source" }, 1)],
        rootUpdates: [{ root: "output", node: { localKey: "source" } }],
      }),
    ).rejects.toThrow("reachable");
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [source("source")],
        rootUpdates: [],
      }),
    ).rejects.toThrow("redirect a document root or replace the layer snapshot");
    expect((await db.query("SELECT 1 FROM image_nodes")).rows).toEqual([]);
    expect((await db.query("SELECT 1 FROM document_revisions")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});

test("a prepared provider execution must be reachable from the resulting roots", async () => {
  const db = await graphDatabase();
  try {
    const sourceDraft = source("source");
    const sourceRecipe = recipeHash(
      canonicalNodeRecipe({
        kind: sourceDraft.kind,
        recipeVersion: sourceDraft.recipeVersion,
        parameters: sourceDraft.parameters,
        inputNodeIds: [],
      }),
    );
    const executionId = `exec_${"4".repeat(64)}`;
    const parameters = {
      adapter: "gateway-image-v1",
      adapter_version: "1",
      model: "paid-v1",
      model_version: null,
      prompt: "restore",
      prompt_version: 1,
      request: { execution_id: executionId },
    };
    const generationRecipe = recipeHash(
      canonicalNodeRecipe({
        kind: "generate",
        recipeVersion: 1,
        parameters,
        inputNodeIds: [logicalNodeId(sourceRecipe)],
      }),
    );
    const prepared = {
      node: { localKey: "generation" } as const,
      executionId,
      evaluationHash: evaluationHash({
        nodeRecipeHash: generationRecipe,
        kind: "generate" as const,
        recipeVersion: 1,
        inputArtifactHashes: [`a_${"1".repeat(64)}`],
      }),
      outputArtifactHash: `a_${"2".repeat(64)}`,
      inputArtifactHashes: [`a_${"1".repeat(64)}`],
      provider: {
        adapter: "gateway-image-v1",
        adapterVersion: "1",
        service: "gateway",
        model: "paid-v1",
        modelVersion: null,
        providerRequestId: "request-1",
        seed: null,
        durationMs: 1,
        costUsd: 0,
        inputPx: 1,
        targetPx: 1,
        attempt: 1,
        densityVerdict: "not-applicable" as const,
        warnings: [],
      },
    };
    const initial = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [
        sourceDraft,
        {
          localKey: "generation",
          kind: "generate",
          recipeVersion: 1,
          parameters,
          inputs: [{ localKey: "source" }],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "generation" } }],
      executions: [prepared],
    });
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: initial.revisionId,
        nodes: [],
        rootUpdates: [{ root: "output", node: { nodeId: initial.nodes.source.id } }],
        executions: [
          {
            ...prepared,
            node: { nodeId: initial.nodes.generation.id },
            executionId: `exec_${"5".repeat(64)}`,
          },
        ],
      }),
    ).rejects.toThrow("reachable from the resulting roots");
    expect(
      (await db.query<{ count: string }>("SELECT count(*)::text AS count FROM node_executions"))
        .rows,
    ).toEqual([{ count: "1" }]);
    expect(
      (await db.query<{ count: string }>("SELECT count(*)::text AS count FROM document_revisions"))
        .rows,
    ).toEqual([{ count: "1" }]);
  } finally {
    await db.close();
  }
});

test("a revision may redirect its root to an existing node without adding nodes", async () => {
  const db = await graphDatabase();
  try {
    const initial = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [source("source")],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });
    const redirected = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: initial.revisionId,
      nodes: [],
      rootUpdates: [{ root: "output", node: { nodeId: initial.nodes.source.id } }],
    });

    expect(redirected.renderHash).toBe(initial.renderHash);
    expect(
      (await db.query<{ count: string }>("SELECT count(*)::text AS count FROM image_nodes")).rows,
    ).toEqual([{ count: "1" }]);
  } finally {
    await db.close();
  }
});

test("a layer-free base update advances the identical output projection", async () => {
  const db = await graphDatabase();
  try {
    const initial = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [source("source")],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });
    const updated = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: initial.revisionId,
      nodes: [develop("base-edit", { nodeId: initial.roots.base! }, 0.5)],
      rootUpdates: [{ root: "base", node: { localKey: "base-edit" } }],
    });

    expect(updated.roots).toEqual({
      base: updated.nodes["base-edit"].id,
      output: updated.nodes["base-edit"].id,
    });
  } finally {
    await db.close();
  }
});

test("layer mutations create immutable complete snapshots and exact composite-v2 projections", async () => {
  const db = await graphDatabase();
  try {
    const preciseOpacity = 0.123456789;
    const projection = compositeV2Projection({ localKey: "base" }, [
      layerDraft("left", "left-content", "left-mask", 0),
      { ...layerDraft("right", "right-content", "right-mask", 1), opacity: preciseOpacity },
    ]);
    const initial = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [
        source("base"),
        develop("left-content", { localKey: "base" }, 0.5),
        mask("left-mask", "1"),
        develop("right-content", { localKey: "base" }, -0.5),
        mask("right-mask", "2"),
        {
          localKey: "composite",
          kind: "composite",
          recipeVersion: 2,
          ...projection,
        },
      ],
      rootUpdates: [
        { root: "base", node: { localKey: "base" } },
        { root: "output", node: { localKey: "composite" } },
      ],
      newLayers: [
        { localKey: "left", role: "subject" },
        { localKey: "right", role: "subject" },
      ],
      layers: [
        layerDraft("left", "left-content", "left-mask", 0),
        { ...layerDraft("right", "right-content", "right-mask", 1), opacity: preciseOpacity },
      ],
    });

    const reorderedLayers: RevisionLayerDraft[] = [
      existingLayer(initial.newLayers.right, initial.layers[1], 0),
      existingLayer(initial.newLayers.left, initial.layers[0], 1),
    ];
    const reordered = await layerMutation(db, initial, reorderedLayers);
    const disabledLayers: RevisionLayerDraft[] = reordered.layers.map((layer) => {
      const draft = existingLayer(layer.id, layer, layer.z);
      draft.enabled = layer.id !== initial.newLayers.left;
      return draft;
    });
    const disabled = await layerMutation(db, reordered, disabledLayers);
    const reloaded = await loadActiveDocument(db, firstPhoto);
    expect(reloaded).not.toBeNull();
    const renamed = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: disabled.revisionId,
      nodes: [],
      rootUpdates: [],
      layers: reloaded!.layers.map((layer) => {
        const draft = existingLayer(layer.id, layer, layer.z);
        draft.name = layer.id === initial.newLayers.right ? "renamed" : layer.name;
        return draft;
      }),
    });
    expect(renamed.renderHash).toBe(disabled.renderHash);
    const opacity = await layerMutation(
      db,
      renamed,
      renamed.layers.map((layer) => {
        const draft = existingLayer(layer.id, layer, layer.z);
        draft.opacity = layer.id === initial.newLayers.right ? 0.25 : layer.opacity;
        return draft;
      }),
    );

    const snapshots = await db.query<{
      revision_id: string;
      layer_id: string;
      name: string;
      z: number;
      opacity: number;
      enabled: boolean;
    }>(
      `SELECT revision_id::text, layer_id::text, name, z, opacity, enabled
       FROM document_revision_layers WHERE photo_id = $1
       ORDER BY revision_id, z`,
      [firstPhoto],
    );
    expect(snapshots.rows.filter(({ revision_id }) => revision_id === initial.revisionId)).toEqual([
      {
        revision_id: initial.revisionId,
        layer_id: initial.newLayers.left,
        name: "left",
        z: 0,
        opacity: 1,
        enabled: true,
      },
      {
        revision_id: initial.revisionId,
        layer_id: initial.newLayers.right,
        name: "right",
        z: 1,
        opacity: preciseOpacity,
        enabled: true,
      },
    ]);
    expect(
      opacity.layers.map(({ id, name, z, opacity: value, enabled }) => ({
        id,
        name,
        z,
        opacity: value,
        enabled,
      })),
    ).toEqual([
      { id: initial.newLayers.right, name: "renamed", z: 0, opacity: 0.25, enabled: true },
      { id: initial.newLayers.left, name: "left", z: 1, opacity: 1, enabled: false },
    ]);
    expect(
      (
        await db.query<{ active_revision_id: string }>(
          "SELECT active_revision_id::text FROM photo_documents WHERE photo_id = $1",
          [firstPhoto],
        )
      ).rows,
    ).toEqual([{ active_revision_id: opacity.revisionId }]);
    expect(await loadActiveDocument(db, firstPhoto)).toEqual({
      revisionId: opacity.revisionId,
      roots: { base: initial.roots.base, output: opacity.roots.output },
      layers: opacity.layers,
      renderHash: opacity.renderHash,
    });
    expect(
      (
        await db.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM document_revisions WHERE photo_id = $1",
          [firstPhoto],
        )
      ).rows,
    ).toEqual([{ count: "5" }]);
    expect(
      (
        await db.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM image_nodes WHERE photo_id = $1 AND kind <> 'composite'",
          [firstPhoto],
        )
      ).rows,
    ).toEqual([{ count: "5" }]);

    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: initial.revisionId,
        nodes: [mask("orphan-mask", "3")],
        rootUpdates: [{ root: "output", node: { nodeId: opacity.roots.output! } }],
        newLayers: [{ localKey: "orphan", role: "subject" }],
        layers: opacity.layers.map((layer) => existingLayer(layer.id, layer, layer.z)),
      }),
    ).rejects.toThrow(RevisionConflictError);
    expect(
      (
        await db.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM layers WHERE photo_id = $1",
          [firstPhoto],
        )
      ).rows,
    ).toEqual([{ count: "2" }]);

    const cleared = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: opacity.revisionId,
      nodes: [],
      rootUpdates: [{ root: "output", node: { nodeId: opacity.roots.base! } }],
      layers: [],
    });
    expect(cleared.layers).toEqual([]);
    expect(cleared.roots.output).toBe(cleared.roots.base);
    expect(
      (await db.query("SELECT 1 FROM layers WHERE photo_id = $1", [firstPhoto])).rows,
    ).toHaveLength(2);
    expect(
      (
        await db.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM document_revision_layers WHERE photo_id = $1 AND revision_id = $2",
          [firstPhoto, cleared.revisionId],
        )
      ).rows,
    ).toEqual([{ count: "0" }]);
  } finally {
    await db.close();
  }
});

test("invalid layer relationships and composite projections roll back every new identity and node", async () => {
  const db = await graphDatabase();
  try {
    const request = {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [source("base"), develop("content", { localKey: "base" }, 0.5), mask("mask", "1")],
      rootUpdates: [{ root: "output" as const, node: { localKey: "content" } }],
    };
    await expect(
      commitRevision(db, {
        ...request,
        newLayers: [{ localKey: "vacancy", role: "vacancy" }],
        layers: [layerDraft("vacancy", "content", "mask", 0)],
      }),
    ).rejects.toThrow("vacancy layer must refer");
    await expect(
      commitRevision(db, {
        ...request,
        newLayers: [{ localKey: "subject", role: "subject" }],
        layers: [
          {
            ...layerDraft("subject", "content", "mask", 1),
            z: 1,
          },
        ],
      }),
    ).rejects.toThrow("contiguous");
    await expect(
      commitRevision(db, {
        ...request,
        newLayers: [{ localKey: "subject", role: "subject" }],
        layers: [layerDraft("subject", "content", "mask", 0)],
      }),
    ).rejects.toThrow("composite recipe version 2");
    await expect(
      commitRevision(db, {
        ...request,
        newLayers: [{ localKey: "subject", role: "subject" }],
        layers: [
          {
            ...layerDraft("subject", "content", "mask", 0),
            contentNode: { localKey: "mask" },
          },
        ],
      }),
    ).rejects.toThrow("content root must produce RGB");
    expect((await db.query("SELECT 1 FROM layers")).rows).toEqual([]);
    expect((await db.query("SELECT 1 FROM image_nodes")).rows).toEqual([]);
    expect((await db.query("SELECT 1 FROM document_revisions")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});

test("an unpublished permanent mask pin cannot enter an active snapshot", async () => {
  const db = await graphDatabase();
  try {
    const layers = [layerDraft("subject", "content", "missing-mask", 0)];
    const projection = compositeV2Projection({ localKey: "base" }, layers);
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [
          source("base"),
          develop("content", { localKey: "base" }, 0.5),
          mask("missing-mask", "9"),
          { localKey: "composite", kind: "composite", recipeVersion: 2, ...projection },
        ],
        rootUpdates: [
          { root: "base", node: { localKey: "base" } },
          { root: "output", node: { localKey: "composite" } },
        ],
        newLayers: [{ localKey: "subject", role: "subject" }],
        layers,
      }),
    ).rejects.toThrow("Mask artifact is unavailable");
    expect((await db.query("SELECT 1 FROM document_revisions")).rows).toEqual([]);
    expect((await db.query("SELECT 1 FROM image_nodes")).rows).toEqual([]);
    expect((await db.query("SELECT 1 FROM layers")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});

test("an output wrapper cannot relabel RGB pixels as a mask", async () => {
  const db = await graphDatabase();
  try {
    const layers = [layerDraft("subject", "base", "fake-mask", 0)];
    const projection = compositeV2Projection({ localKey: "base" }, layers);
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [
          source("base"),
          {
            localKey: "fake-mask",
            kind: "output",
            recipeVersion: 1,
            parameters: { format: "mask", color_space: "coverage" },
            inputs: [{ localKey: "base" }],
          },
          { localKey: "composite", kind: "composite", recipeVersion: 2, ...projection },
        ],
        rootUpdates: [
          { root: "base", node: { localKey: "base" } },
          { root: "output", node: { localKey: "composite" } },
        ],
        newLayers: [{ localKey: "subject", role: "subject" }],
        layers,
      }),
    ).rejects.toThrow("Output pixel format disagrees with its input");
  } finally {
    await db.close();
  }
});

test("an RGB-only operation cannot relabel a mask branch as layer content", async () => {
  const db = await graphDatabase();
  try {
    const layers = [layerDraft("subject", "fake-content", "layer-mask", 0)];
    const projection = compositeV2Projection({ localKey: "base" }, layers);
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [
          source("base"),
          mask("content-mask", "1"),
          {
            localKey: "fake-content",
            kind: "delta",
            recipeVersion: 1,
            parameters: { exposure: 0.5 },
            inputs: [{ localKey: "content-mask" }],
          },
          mask("layer-mask", "2"),
          { localKey: "composite", kind: "composite", recipeVersion: 2, ...projection },
        ],
        rootUpdates: [
          { root: "base", node: { localKey: "base" } },
          { root: "output", node: { localKey: "composite" } },
        ],
        newLayers: [{ localKey: "subject", role: "subject" }],
        layers,
      }),
    ).rejects.toThrow("delta input 0 must produce RGB pixels");
  } finally {
    await db.close();
  }
});

test("an activated RGB branch cannot hide an unpublished permanent mask pin", async () => {
  const db = await graphDatabase();
  try {
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [
          source("base"),
          mask("missing-mask", "9"),
          {
            localKey: "masked",
            kind: "mask_composite",
            recipeVersion: 1,
            parameters: { feather: 0 },
            inputs: [{ localKey: "base" }, { localKey: "base" }, { localKey: "missing-mask" }],
          },
        ],
        rootUpdates: [{ root: "output", node: { localKey: "masked" } }],
      }),
    ).rejects.toThrow("Mask artifact is unavailable");
    expect((await db.query("SELECT 1 FROM document_revisions")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});

test("a permanent mask cannot become the document's RGB base and output", async () => {
  const db = await graphDatabase();
  try {
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [mask("mask", "1")],
        rootUpdates: [{ root: "output", node: { localKey: "mask" } }],
      }),
    ).rejects.toThrow("A document base root must produce RGB pixels");
  } finally {
    await db.close();
  }
});

test("layer identity lookup accepts only a full id or an unambiguous photo-scoped prefix", async () => {
  const db = await graphDatabase();
  try {
    const ids = ["0199a7c2-3b1e-7c40-8f2a-1d0e5a91c011", "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c012"];
    await db.query(
      `INSERT INTO layers (photo_id, id, role)
       VALUES ($1, $2, 'subject'), ($1, $3, 'subject'), ($4, $2, 'subject')`,
      [firstPhoto, ids[0], ids[1], secondPhoto],
    );

    await expect(resolveLayerId(db, firstPhoto, `${ids[0].slice(0, -1)}1`)).resolves.toBe(ids[0]);
    await expect(resolveLayerId(db, firstPhoto, ids[0].slice(0, -1))).rejects.toMatchObject({
      code: "not_found",
      data: { id: ids[0].slice(0, -1), reason: "ambiguous" },
    });
    await expect(resolveLayerId(db, firstPhoto, "not-a-layer")).rejects.toMatchObject({
      code: "usage",
    });
  } finally {
    await db.close();
  }
});

function source(localKey: string) {
  return {
    localKey,
    kind: "source" as const,
    recipeVersion: 1,
    parameters: { orientation: 1 },
    inputs: [],
  };
}

function develop(
  localKey: string,
  input: { localKey: string } | { nodeId: string },
  exposure: number,
) {
  return {
    localKey,
    kind: "develop" as const,
    recipeVersion: 1,
    parameters: { exposure },
    inputs: [input],
  };
}

function mask(localKey: string, digit: string) {
  return {
    localKey,
    kind: "mask" as const,
    recipeVersion: 1,
    parameters: { artifact_hash: `a_${digit.repeat(64)}` },
    inputs: [],
  };
}

function layerDraft(
  localKey: string,
  contentKey: string,
  maskKey: string,
  z: number,
): RevisionLayerDraft {
  return {
    layer: { localKey },
    name: localKey,
    z,
    contentNode: { localKey: contentKey },
    maskNode: { localKey: maskKey },
    opacity: 1,
    blend: "normal",
    enabled: true,
  };
}

function existingLayer(
  id: string,
  layer: {
    name: string;
    contentNodeId: string;
    maskNodeId: string;
    opacity: number;
    blend: "normal";
    enabled: boolean;
  },
  z: number,
): RevisionLayerDraft {
  return {
    layer: { layerId: id },
    name: layer.name,
    z,
    contentNode: { nodeId: layer.contentNodeId },
    maskNode: { nodeId: layer.maskNodeId },
    opacity: layer.opacity,
    blend: layer.blend,
    enabled: layer.enabled,
  };
}

async function layerMutation(
  db: PGlite,
  current: Awaited<ReturnType<typeof commitRevision>>,
  layers: RevisionLayerDraft[],
) {
  const projection = compositeV2Projection({ nodeId: current.roots.base! }, layers);
  return await commitRevision(db, {
    photoId: firstPhoto,
    expectedRevisionId: current.revisionId,
    nodes: [
      {
        localKey: "composite",
        kind: "composite",
        recipeVersion: 2,
        ...projection,
      },
    ],
    rootUpdates: [{ root: "output", node: { localKey: "composite" } }],
    layers,
  });
}

async function graphDatabase(): Promise<PGlite> {
  const db = await testDatabase();
  await migrate(db);
  await db.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_3dac5c943a33dcc4', 1, 1, 1, 1),
            ($2, 'ck_aaaaaaaaaaaaaaaa', 1, 1, 1, 1)`,
    [firstPhoto, secondPhoto],
  );
  await db.query(
    `INSERT INTO image_artifacts
       (artifact_hash, media_type, bytes, w, h, artifact_available)
     VALUES ($1, $4, 1, 1, 1, true),
            ($2, $4, 1, 1, 1, true),
            ($3, $4, 1, 1, 1, true)`,
    [...["1", "2", "3"].map((digit) => `a_${digit.repeat(64)}`), MASK_ARTIFACT_MEDIA_TYPE],
  );
  return db;
}
