import { randomUUID } from "node:crypto";
import {
  canonicalJson,
  canonicalNodeRecipe,
  canonicalParameters,
  imageNodeRegistry,
  logicalNodeId,
  recipeHash,
  renderHashForNode,
} from "./recipes.js";
import type { ImageNodeKind, JsonValue, StoredImageNode } from "./types.js";
import {
  MASK_ARTIFACT_MEDIA_TYPE,
  registerPublishedArtifact,
  type PublishedArtifact,
} from "../artifacts/publication.js";
import {
  compositeV2Projection,
  layerRoles,
  type LayerReference,
  type LayerRole,
  type NewLayerIdentity,
  type RevisionLayer,
  type RevisionLayerDraft,
} from "../layers/model.js";

interface QueryResult<Row> {
  rows: Row[];
}

export interface GraphTransaction {
  query<Row>(sql: string, parameters?: unknown[]): Promise<QueryResult<Row>>;
}

export interface GraphDatabase extends GraphTransaction {
  transaction<Result>(run: (transaction: GraphTransaction) => Promise<Result>): Promise<Result>;
}

export type NodeReference = { nodeId: string } | { localKey: string };
export interface NodeDraft {
  localKey: string;
  kind: ImageNodeKind;
  recipeVersion: number;
  parameters: JsonValue;
  inputs: NodeReference[];
}
export interface CommitRevisionRequest {
  photoId: string;
  expectedRevisionId: string | null;
  nodes: NodeDraft[];
  rootUpdates: Array<{ root: "base" | "output"; node: NodeReference }>;
  newLayers?: NewLayerIdentity[];
  layers?: RevisionLayerDraft[];
  artifacts?: PublishedArtifact[];
}
export interface CommitRevisionResult {
  revisionId: string;
  nodes: Record<string, StoredImageNode>;
  roots: { base?: string; output?: string };
  newLayers: Record<string, string>;
  layers: RevisionLayer[];
  renderHash: string | null;
}
export interface ActiveDocument {
  revisionId: string;
  roots: { base: string; output: string };
  layers: RevisionLayer[];
  renderHash: `r_${string}`;
}

export class RevisionConflictError extends Error {
  constructor() {
    super("The document changed before this revision could be committed");
  }
}

export async function ensurePhotoDocument(
  database: GraphDatabase,
  request: { photoId: string; orientation: number },
): Promise<{
  revisionId: string;
  outputNodeId: `node_${string}`;
  renderHash: `r_${string}`;
}> {
  const existing = await loadActiveOutput(database, request.photoId);
  if (existing) return existing;
  let committed: CommitRevisionResult;
  try {
    committed = await commitRevision(database, {
      photoId: request.photoId,
      expectedRevisionId: null,
      nodes: [
        {
          localKey: "source",
          kind: "source",
          recipeVersion: 1,
          parameters: { orientation: request.orientation },
          inputs: [],
        },
        {
          localKey: "output",
          kind: "output",
          recipeVersion: 1,
          parameters: { format: "display-rgb", color_space: "srgb" },
          inputs: [{ localKey: "source" }],
        },
      ],
      rootUpdates: [
        { root: "base", node: { localKey: "output" } },
        { root: "output", node: { localKey: "output" } },
      ],
    });
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      const winner = await loadActiveOutput(database, request.photoId);
      if (winner) return winner;
    }
    throw error;
  }
  return {
    revisionId: committed.revisionId,
    outputNodeId: committed.roots.output! as `node_${string}`,
    renderHash: committed.renderHash! as `r_${string}`,
  };
}

async function loadActiveOutput(
  database: GraphTransaction,
  photoId: string,
): Promise<{
  revisionId: string;
  outputNodeId: `node_${string}`;
  renderHash: `r_${string}`;
} | null> {
  const existing = await database.query<{
    active_revision_id: string | null;
    node_id: string | null;
  }>(
    `SELECT document.active_revision_id, root.node_id
     FROM photo_documents AS document
     LEFT JOIN document_revision_roots AS root
       ON root.photo_id = document.photo_id
      AND root.revision_id = document.active_revision_id
      AND root.root_name = 'output'
     WHERE document.photo_id = $1`,
    [photoId],
  );
  const row = existing.rows[0];
  if (!row?.active_revision_id || !row.node_id) return null;
  return {
    revisionId: row.active_revision_id,
    outputNodeId: row.node_id as `node_${string}`,
    renderHash: renderHashForNode(row.node_id),
  };
}

export async function loadActiveDocument(
  database: GraphTransaction,
  photoId: string,
): Promise<ActiveDocument | null> {
  const document = await database.query<{ active_revision_id: string | null }>(
    "SELECT active_revision_id::text FROM photo_documents WHERE photo_id = $1",
    [photoId],
  );
  const revisionId = document.rows[0]?.active_revision_id;
  if (!revisionId) return null;
  const roots = await loadRevisionRoots(database, photoId, revisionId);
  if (!roots.base || !roots.output) throw new Error("The active document is missing a typed root");
  return {
    revisionId,
    roots: { base: roots.base, output: roots.output },
    layers: await loadRevisionLayers(database, photoId, revisionId),
    renderHash: renderHashForNode(roots.output),
  };
}

export async function commitRevision(
  database: GraphDatabase,
  request: CommitRevisionRequest,
): Promise<CommitRevisionResult> {
  assertRequestShape(request);
  return await database.transaction(async (transaction) => {
    const activeRevisionId = await lockDocument(transaction, request.photoId);
    if (activeRevisionId !== request.expectedRevisionId) {
      throw new RevisionConflictError();
    }
    await mapInOrder(request.artifacts ?? [], async (artifact) => {
      await registerPublishedArtifact(transaction, artifact);
    });

    const drafts = new Map(request.nodes.map((node) => [node.localKey, node]));
    const resolved = new Map<string, StoredImageNode>();
    const resolving = new Set<string>();
    const resolveReference = async (reference: NodeReference): Promise<StoredImageNode> => {
      if ("nodeId" in reference) {
        return await loadNode(transaction, request.photoId, reference.nodeId);
      }
      const cached = resolved.get(reference.localKey);
      if (cached) return cached;
      const draft = drafts.get(reference.localKey);
      if (!draft) throw new Error(`Unknown local graph node: ${reference.localKey}`);
      if (resolving.has(reference.localKey)) throw new Error("Image graph cycle refused");
      resolving.add(reference.localKey);
      const inputs = await mapInOrder(draft.inputs, resolveReference);
      const parameters = canonicalParameters(draft.kind, draft.parameters);
      const recipe = recipeHash(
        canonicalNodeRecipe({
          kind: draft.kind,
          recipeVersion: draft.recipeVersion,
          parameters,
          inputNodeIds: inputs.map((input) => input.id),
        }),
      );
      const node: StoredImageNode = {
        id: logicalNodeId(recipe),
        photoId: request.photoId,
        kind: draft.kind,
        recipeVersion: draft.recipeVersion,
        parameters,
        recipeHash: recipe,
      };
      await storeNode(transaction, node, inputs);
      resolving.delete(reference.localKey);
      resolved.set(reference.localKey, node);
      return node;
    };

    const rootUpdates = new Map<"base" | "output", string>(
      await mapInOrder(request.rootUpdates, async (update) => {
        const node = await resolveReference(update.node);
        await assertRootActivationAllowed(transaction, node);
        return [update.root, node.id];
      }),
    );
    const inheritedRoots = activeRevisionId
      ? await loadRevisionRoots(transaction, request.photoId, activeRevisionId)
      : {};
    const resultingRoots = { ...inheritedRoots, ...Object.fromEntries(rootUpdates) };
    if (!resultingRoots.output) throw new Error("A revision requires an output root");
    if (!resultingRoots.base) resultingRoots.base = resultingRoots.output;

    const newLayerIds = await storeLayerIdentities(
      transaction,
      request.photoId,
      request.newLayers ?? [],
    );
    const layerDrafts = request.layers ?? (activeRevisionId ? undefined : []);
    const layers = layerDrafts
      ? await resolveLayerSnapshot(
          transaction,
          request.photoId,
          layerDrafts,
          newLayerIds,
          resolveReference,
        )
      : await loadRevisionLayers(transaction, request.photoId, activeRevisionId!);
    if (
      request.layers === undefined &&
      layers.length === 0 &&
      rootUpdates.has("output") &&
      !rootUpdates.has("base")
    ) {
      resultingRoots.base = resultingRoots.output;
      rootUpdates.set("base", resultingRoots.base);
    } else if (
      request.layers === undefined &&
      layers.length === 0 &&
      rootUpdates.has("base") &&
      !rootUpdates.has("output")
    ) {
      resultingRoots.output = resultingRoots.base;
      rootUpdates.set("output", resultingRoots.output);
    }
    const snapshottedLayerIds = new Set(layers.map(({ id }) => id));
    if (Object.values(newLayerIds).some((id) => !snapshottedLayerIds.has(id))) {
      throw new Error("Every new layer identity must appear in the resulting snapshot");
    }
    const retainedRoots = new Set([
      resultingRoots.base,
      resultingRoots.output,
      ...layers.flatMap((layer) => [layer.contentNodeId, layer.maskNodeId]),
    ]);
    await mapInOrder([...retainedRoots], async (nodeId) => {
      await assertMaskArtifactsAvailable(transaction, request.photoId, nodeId);
    });
    await assertCompositeProjection(
      transaction,
      request.photoId,
      resultingRoots.base,
      resultingRoots.output,
      layers,
    );
    if (resolved.size !== drafts.size) {
      throw new Error(
        "Every supplied graph node must be reachable from a resulting document root or layer",
      );
    }

    const revisionId = randomUUID();
    await transaction.query(
      `INSERT INTO document_revisions (id, photo_id, parent_revision_id)
       VALUES ($1, $2, $3)`,
      [revisionId, request.photoId, activeRevisionId],
    );
    if (activeRevisionId) {
      await transaction.query(
        `INSERT INTO document_revision_roots (revision_id, photo_id, root_name, node_id)
         SELECT $1, photo_id, root_name, node_id FROM document_revision_roots
         WHERE photo_id = $2 AND revision_id = $3`,
        [revisionId, request.photoId, activeRevisionId],
      );
    }
    await mapInOrder([...rootUpdates], async ([root, nodeId]) => {
      await transaction.query(
        `INSERT INTO document_revision_roots (revision_id, photo_id, root_name, node_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (photo_id, revision_id, root_name)
         DO UPDATE SET node_id = EXCLUDED.node_id`,
        [revisionId, request.photoId, root, nodeId],
      );
    });
    if (!rootUpdates.has("base")) {
      await transaction.query(
        `INSERT INTO document_revision_roots (revision_id, photo_id, root_name, node_id)
         VALUES ($1, $2, 'base', $3)
         ON CONFLICT (photo_id, revision_id, root_name) DO UPDATE SET node_id = EXCLUDED.node_id`,
        [revisionId, request.photoId, resultingRoots.base],
      );
    }
    await storeRevisionLayers(transaction, request.photoId, revisionId, layers);
    await transaction.query(
      "UPDATE photo_documents SET active_revision_id = $1 WHERE photo_id = $2",
      [revisionId, request.photoId],
    );
    const roots = await loadRevisionRoots(transaction, request.photoId, revisionId);
    return {
      revisionId,
      nodes: Object.fromEntries(resolved),
      roots,
      newLayers: newLayerIds,
      layers,
      renderHash: roots.output ? renderHashForNode(roots.output) : null,
    };
  });
}

export async function undoRevision(
  database: GraphDatabase,
  request: { photoId: string; expectedRevisionId: string },
): Promise<{ revisionId: string | null; renderHash: string | null }> {
  return await database.transaction(async (transaction) => {
    const activeRevisionId = await lockDocument(transaction, request.photoId);
    if (activeRevisionId !== request.expectedRevisionId) {
      throw new Error("The document changed before undo could be committed");
    }
    const revision = await transaction.query<{ parent_revision_id: string | null }>(
      "SELECT parent_revision_id FROM document_revisions WHERE id = $1 AND photo_id = $2",
      [activeRevisionId, request.photoId],
    );
    const parentRevisionId = revision.rows[0]?.parent_revision_id ?? null;
    await transaction.query(
      "UPDATE photo_documents SET active_revision_id = $1 WHERE photo_id = $2",
      [parentRevisionId, request.photoId],
    );
    const roots = parentRevisionId
      ? await loadRevisionRoots(transaction, request.photoId, parentRevisionId)
      : ({} as { base?: string; output?: string });
    return {
      revisionId: parentRevisionId,
      renderHash: roots.output ? renderHashForNode(roots.output) : null,
    };
  });
}

export async function setRevisionPinned(
  database: GraphTransaction,
  request: { photoId: string; revisionId: string; pinned: boolean },
): Promise<void> {
  const result = await database.query<{ id: string }>(
    `UPDATE document_revisions SET pinned = $3
     WHERE photo_id = $1 AND id = $2 RETURNING id::text`,
    [request.photoId, request.revisionId, request.pinned],
  );
  if (result.rows.length !== 1) {
    throw new Error(`Document revision does not exist for photo: ${request.revisionId}`);
  }
}

async function lockDocument(
  transaction: GraphTransaction,
  photoId: string,
): Promise<string | null> {
  await transaction.query(
    `INSERT INTO photo_documents (photo_id, active_revision_id)
     VALUES ($1, NULL) ON CONFLICT (photo_id) DO NOTHING`,
    [photoId],
  );
  const result = await transaction.query<{ active_revision_id: string | null }>(
    "SELECT active_revision_id FROM photo_documents WHERE photo_id = $1 FOR UPDATE",
    [photoId],
  );
  if (result.rows.length !== 1) throw new Error(`Photo does not exist: ${photoId}`);
  return result.rows[0].active_revision_id;
}

async function storeNode(
  transaction: GraphTransaction,
  node: StoredImageNode,
  inputs: StoredImageNode[],
): Promise<void> {
  await transaction.query(
    `INSERT INTO image_nodes (photo_id, id, kind, recipe_version, parameters, recipe_hash)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (photo_id, id) DO NOTHING`,
    [
      node.photoId,
      node.id,
      node.kind,
      node.recipeVersion,
      JSON.stringify(node.parameters),
      node.recipeHash,
    ],
  );
  const stored = await loadNode(transaction, node.photoId, node.id);
  if (
    stored.kind !== node.kind ||
    stored.recipeVersion !== node.recipeVersion ||
    stored.recipeHash !== node.recipeHash ||
    canonicalJson(stored.parameters) !== canonicalJson(node.parameters)
  ) {
    throw new Error(`Image node identity collision: ${node.id}`);
  }
  await mapInOrder(inputs, async (input, index) => {
    await transaction.query(
      `INSERT INTO image_node_inputs (photo_id, node_id, input_index, input_node_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (photo_id, node_id, input_index) DO NOTHING`,
      [node.photoId, node.id, index, input.id],
    );
  });
  const storedInputs = await transaction.query<{ input_node_id: string }>(
    `SELECT input_node_id FROM image_node_inputs
     WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index`,
    [node.photoId, node.id],
  );
  if (
    storedInputs.rows.length !== inputs.length ||
    storedInputs.rows.some((input, index) => input.input_node_id !== inputs[index].id)
  ) {
    throw new Error(`Image node identity collision: ${node.id}`);
  }
}

async function loadNode(
  transaction: GraphTransaction,
  photoId: string,
  nodeId: string,
): Promise<StoredImageNode> {
  const result = await transaction.query<{
    id: string;
    photo_id: string;
    kind: ImageNodeKind;
    recipe_version: number;
    parameters: JsonValue;
    recipe_hash: string;
  }>(
    `SELECT id, photo_id, kind, recipe_version, parameters, recipe_hash
     FROM image_nodes WHERE photo_id = $1 AND id = $2`,
    [photoId, nodeId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Graph input does not exist for photo: ${nodeId}`);
  return {
    id: row.id,
    photoId: row.photo_id,
    kind: row.kind,
    recipeVersion: row.recipe_version,
    parameters: row.parameters,
    recipeHash: row.recipe_hash,
  };
}

async function assertRootActivationAllowed(
  transaction: GraphTransaction,
  node: StoredImageNode,
): Promise<void> {
  const reachable = await transaction.query<{
    id: string;
    kind: ImageNodeKind;
    has_published_artifact: boolean;
  }>(
    `WITH RECURSIVE reachable(node_id) AS (
       VALUES ($2::text)
       UNION
       SELECT edge.input_node_id
       FROM image_node_inputs AS edge
       JOIN reachable ON reachable.node_id = edge.node_id
       WHERE edge.photo_id = $1
     )
     SELECT candidate.id, candidate.kind,
       EXISTS (
         SELECT 1 FROM node_executions AS execution
         JOIN image_artifacts AS artifact
           ON artifact.artifact_hash = execution.output_artifact_hash
         WHERE execution.photo_id = candidate.photo_id
           AND execution.node_id = candidate.id
           AND artifact.artifact_available = true
       ) AS has_published_artifact
     FROM reachable
     JOIN image_nodes AS candidate
       ON candidate.photo_id = $1 AND candidate.id = reachable.node_id`,
    [node.photoId, node.id],
  );
  const unavailable = reachable.rows.find(
    (candidate) =>
      !imageNodeRegistry[candidate.kind].deterministic && !candidate.has_published_artifact,
  );
  if (unavailable) {
    throw new Error(
      "A nondeterministic output cannot become active before its artifact is published",
    );
  }
}

async function loadRevisionRoots(
  transaction: GraphTransaction,
  photoId: string,
  revisionId: string,
): Promise<{ base?: string; output?: string }> {
  const result = await transaction.query<{ root_name: "base" | "output"; node_id: string }>(
    `SELECT root_name, node_id FROM document_revision_roots
     WHERE photo_id = $1 AND revision_id = $2`,
    [photoId, revisionId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.root_name, row.node_id]));
}

async function storeLayerIdentities(
  transaction: GraphTransaction,
  photoId: string,
  drafts: NewLayerIdentity[],
): Promise<Record<string, string>> {
  const keys = drafts.map(({ localKey }) => localKey);
  if (keys.some((key) => key.length === 0) || new Set(keys).size !== keys.length) {
    throw new Error("Local layer keys must be non-empty and unique");
  }
  const ids = Object.fromEntries(keys.map((key) => [key, randomUUID()]));
  await mapInOrder(drafts, async (draft) => {
    if (!layerRoles.includes(draft.role)) throw new Error(`Unknown layer role: ${draft.role}`);
    await transaction.query(
      `INSERT INTO layers (photo_id, id, role, of_layer) VALUES ($1, $2, $3, NULL)`,
      [photoId, ids[draft.localKey], draft.role],
    );
  });
  await mapInOrder(drafts, async (draft) => {
    const ofLayer = draft.ofLayer
      ? await resolveLayerReference(transaction, photoId, draft.ofLayer, ids)
      : null;
    await assertLayerRolePairing(transaction, photoId, draft.role, ofLayer);
    if (ofLayer) {
      await transaction.query("UPDATE layers SET of_layer = $3 WHERE photo_id = $1 AND id = $2", [
        photoId,
        ids[draft.localKey],
        ofLayer,
      ]);
    }
  });
  return ids;
}

async function resolveLayerSnapshot(
  transaction: GraphTransaction,
  photoId: string,
  drafts: RevisionLayerDraft[],
  newLayerIds: Record<string, string>,
  resolveNode: (reference: NodeReference) => Promise<StoredImageNode>,
): Promise<RevisionLayer[]> {
  const seen = new Set<string>();
  return await mapInOrder(drafts, async (draft, index) => {
    if (draft.z !== index)
      throw new Error("Layer z order must be contiguous and match snapshot order");
    if (!Number.isFinite(draft.opacity) || draft.opacity < 0 || draft.opacity > 1) {
      throw new Error("Layer opacity must be between 0 and 1");
    }
    if (draft.blend !== "normal") throw new Error("Only normal layer blending is supported");
    const id = await resolveLayerReference(transaction, photoId, draft.layer, newLayerIds);
    if (seen.has(id)) throw new Error("A revision may snapshot each layer once");
    seen.add(id);
    const identity = await loadLayerIdentity(transaction, photoId, id);
    const content = await resolveNode(draft.contentNode);
    const mask = await resolveNode(draft.maskNode);
    if ((await nodePixelKind(transaction, photoId, content.id)) !== "rgb") {
      throw new Error("A layer content root must produce RGB pixels");
    }
    if ((await nodePixelKind(transaction, photoId, mask.id)) !== "mask") {
      throw new Error("A layer mask root must produce mask pixels");
    }
    await assertRootActivationAllowed(transaction, content);
    await assertRootActivationAllowed(transaction, mask);
    return {
      id,
      role: identity.role,
      ofLayer: identity.of_layer,
      name: draft.name,
      z: draft.z,
      contentNodeId: content.id,
      maskNodeId: mask.id,
      opacity: draft.opacity,
      blend: draft.blend,
      enabled: draft.enabled,
    };
  });
}

async function assertMaskArtifactsAvailable(
  transaction: GraphTransaction,
  photoId: string,
  nodeId: string,
): Promise<void> {
  const unavailable = await transaction.query<{ artifact_hash: string }>(
    `WITH RECURSIVE ancestors(node_id) AS (
       SELECT $2::text
       UNION
       SELECT edge.input_node_id
       FROM image_node_inputs AS edge
       JOIN ancestors ON ancestors.node_id = edge.node_id
       WHERE edge.photo_id = $1
     )
     SELECT node.parameters->>'artifact_hash' AS artifact_hash
     FROM ancestors
     JOIN image_nodes AS node ON node.photo_id = $1 AND node.id = ancestors.node_id
     LEFT JOIN image_artifacts AS artifact
       ON artifact.artifact_hash = node.parameters->>'artifact_hash'
     WHERE node.kind = 'mask'
       AND (COALESCE(artifact.artifact_available, false) = false OR artifact.media_type <> $3)
     LIMIT 1`,
    [photoId, nodeId, MASK_ARTIFACT_MEDIA_TYPE],
  );
  if (unavailable.rows.length > 0) {
    throw new Error(
      `Mask artifact is unavailable or has the wrong media type: ${unavailable.rows[0].artifact_hash}`,
    );
  }
}

async function resolveLayerReference(
  transaction: GraphTransaction,
  photoId: string,
  reference: LayerReference,
  newLayerIds: Record<string, string>,
): Promise<string> {
  const id = "layerId" in reference ? reference.layerId : newLayerIds[reference.localKey];
  if (!id)
    throw new Error(`Unknown local layer: ${"localKey" in reference ? reference.localKey : id}`);
  await loadLayerIdentity(transaction, photoId, id);
  return id;
}

async function loadLayerIdentity(
  transaction: GraphTransaction,
  photoId: string,
  layerId: string,
): Promise<{ role: LayerRole; of_layer: string | null }> {
  const result = await transaction.query<{ role: LayerRole; of_layer: string | null }>(
    "SELECT role, of_layer::text FROM layers WHERE photo_id = $1 AND id = $2",
    [photoId, layerId],
  );
  if (!result.rows[0]) throw new Error(`Layer does not exist for photo: ${layerId}`);
  return result.rows[0];
}

async function assertLayerRolePairing(
  transaction: GraphTransaction,
  photoId: string,
  role: LayerRole,
  ofLayer: string | null,
): Promise<void> {
  if (role !== "vacancy") {
    if (ofLayer) throw new Error(`A ${role} layer cannot refer to another layer`);
    return;
  }
  if (!ofLayer) throw new Error("A vacancy layer must refer to its subject layer");
  const related = await loadLayerIdentity(transaction, photoId, ofLayer);
  if (related.role !== "subject") throw new Error("A vacancy layer must refer to a subject layer");
}

async function nodePixelKind(
  transaction: GraphTransaction,
  photoId: string,
  nodeId: string,
): Promise<"rgb" | "mask"> {
  const node = await transaction.query<{
    kind: ImageNodeKind;
    recipe_version: number;
    parameters: JsonValue;
  }>("SELECT kind, recipe_version, parameters FROM image_nodes WHERE photo_id = $1 AND id = $2", [
    photoId,
    nodeId,
  ]);
  const row = node.rows[0];
  if (!row) throw new Error(`Graph input does not exist for photo: ${nodeId}`);
  if (row.kind === "source") return "rgb";
  if (row.kind === "solid") return "rgb";
  if (row.kind === "mask") return "mask";
  const inputIds = await loadPixelInputs(transaction, photoId, nodeId, row.kind);
  const inputKinds = await mapInOrder(inputIds, async (input) => {
    return await nodePixelKind(transaction, photoId, input);
  });
  if (row.kind === "output") {
    const declared = (row.parameters as { format?: string }).format === "mask" ? "mask" : "rgb";
    const actual = inputKinds[0];
    if (declared !== actual) throw new Error("Output pixel format disagrees with its input");
    return actual;
  }
  if (row.kind === "transform" || row.kind === "resample") {
    return inputKinds[0];
  }
  if (row.kind === "crop") return inputKinds[0];
  if (
    row.kind === "develop" ||
    row.kind === "generate" ||
    row.kind === "upscale" ||
    row.kind === "delta" ||
    row.kind === "markup"
  ) {
    assertPixelInputKinds(row.kind, inputKinds, ["rgb"]);
    return "rgb";
  }
  if (row.kind === "mask_composite") {
    assertPixelInputKinds(row.kind, inputKinds, ["rgb", "rgb", "mask"]);
    return "rgb";
  }
  if (row.kind === "composite") {
    const expected =
      row.recipe_version === 2
        ? inputKinds.map((_kind, index) => (index > 0 && index % 2 === 0 ? "mask" : "rgb"))
        : inputKinds.map(() => "rgb" as const);
    assertPixelInputKinds(row.kind, inputKinds, expected);
    return "rgb";
  }
  throw new Error(`Unknown image node kind: ${row.kind}`);
}

function assertPixelInputKinds(
  kind: ImageNodeKind,
  actual: Array<"rgb" | "mask">,
  expected: Array<"rgb" | "mask">,
): void {
  const invalid = actual.findIndex((value, index) => value !== expected[index]);
  if (invalid >= 0) {
    throw new Error(
      `${kind} input ${invalid} must produce ${expected[invalid].toUpperCase()} pixels`,
    );
  }
}

async function loadPixelInputs(
  transaction: GraphTransaction,
  photoId: string,
  nodeId: string,
  kind: ImageNodeKind,
): Promise<string[]> {
  const input = await transaction.query<{ input_node_id: string }>(
    `SELECT input_node_id FROM image_node_inputs
     WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index`,
    [photoId, nodeId],
  );
  if (input.rows.length === 0) throw new Error(`${kind} is missing its pixel input`);
  return input.rows.map((row) => row.input_node_id);
}

async function assertCompositeProjection(
  transaction: GraphTransaction,
  photoId: string,
  baseNodeId: string,
  outputNodeId: string,
  layers: RevisionLayer[],
): Promise<void> {
  if ((await nodePixelKind(transaction, photoId, baseNodeId)) !== "rgb") {
    throw new Error("A document base root must produce RGB pixels");
  }
  if ((await nodePixelKind(transaction, photoId, outputNodeId)) !== "rgb") {
    throw new Error("A document output root must produce RGB pixels");
  }
  if (layers.length === 0) {
    if (baseNodeId !== outputNodeId) {
      throw new Error("A revision without layers must project its base directly to output");
    }
    return;
  }
  const output = await loadNode(transaction, photoId, outputNodeId);
  if (output.kind !== "composite" || output.recipeVersion !== 2) {
    throw new Error("A layered revision output must be a composite recipe version 2");
  }
  const expected = compositeV2Projection(
    baseNodeId,
    layers.map((layer) => ({
      contentNode: layer.contentNodeId,
      maskNode: layer.maskNodeId,
      opacity: layer.opacity,
      blend: layer.blend,
      enabled: layer.enabled,
    })),
  );
  const inputs = await transaction.query<{ input_node_id: string }>(
    `SELECT input_node_id FROM image_node_inputs
     WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index`,
    [photoId, outputNodeId],
  );
  if (
    inputs.rows.length !== expected.inputs.length ||
    inputs.rows.some((input, index) => input.input_node_id !== expected.inputs[index]) ||
    canonicalJson(output.parameters) !== canonicalJson(expected.parameters)
  ) {
    throw new Error("Composite recipe version 2 must exactly project the enabled layer snapshot");
  }
}

async function loadRevisionLayers(
  transaction: GraphTransaction,
  photoId: string,
  revisionId: string,
): Promise<RevisionLayer[]> {
  const result = await transaction.query<{
    id: string;
    role: LayerRole;
    of_layer: string | null;
    name: string;
    z: number;
    content_node_id: string;
    mask_node_id: string;
    opacity: number;
    blend: "normal";
    enabled: boolean;
  }>(
    `SELECT identity.id::text, identity.role, identity.of_layer::text, snapshot.name, snapshot.z,
            snapshot.content_node_id, snapshot.mask_node_id, snapshot.opacity,
            snapshot.blend, snapshot.enabled
     FROM document_revision_layers AS snapshot
     JOIN layers AS identity
       ON (identity.photo_id, identity.id) = (snapshot.photo_id, snapshot.layer_id)
     WHERE snapshot.photo_id = $1 AND snapshot.revision_id = $2
     ORDER BY snapshot.z`,
    [photoId, revisionId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    role: row.role,
    ofLayer: row.of_layer,
    name: row.name,
    z: row.z,
    contentNodeId: row.content_node_id,
    maskNodeId: row.mask_node_id,
    opacity: row.opacity,
    blend: row.blend,
    enabled: row.enabled,
  }));
}

async function storeRevisionLayers(
  transaction: GraphTransaction,
  photoId: string,
  revisionId: string,
  layers: RevisionLayer[],
): Promise<void> {
  await mapInOrder(layers, async (layer) => {
    await transaction.query(
      `INSERT INTO document_revision_layers
         (photo_id, revision_id, layer_id, name, z, content_node_id, mask_node_id,
          opacity, blend, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        photoId,
        revisionId,
        layer.id,
        layer.name,
        layer.z,
        layer.contentNodeId,
        layer.maskNodeId,
        layer.opacity,
        layer.blend,
        layer.enabled,
      ],
    );
  });
}

function assertRequestShape(request: CommitRevisionRequest): void {
  const keys = request.nodes.map((node) => node.localKey);
  if (keys.some((key) => key.length === 0) || new Set(keys).size !== keys.length) {
    throw new Error("Local graph node keys must be non-empty and unique");
  }
  const roots = request.rootUpdates.map((update) => update.root);
  if (new Set(roots).size !== roots.length) throw new Error("A revision may update each root once");
  if (request.rootUpdates.length === 0 && request.layers === undefined) {
    throw new Error("A revision must redirect a document root or replace the layer snapshot");
  }
}

async function mapInOrder<Input, Output>(
  values: Input[],
  map: (value: Input, index: number) => Promise<Output>,
  index = 0,
  output: Output[] = [],
): Promise<Output[]> {
  if (index === values.length) return output;
  output.push(await map(values[index], index));
  return await mapInOrder(values, map, index + 1, output);
}
