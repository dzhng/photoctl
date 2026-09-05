import { transformMaskPixels } from "@photoctl/img";
import { readArtifactMask } from "../artifacts/publication.js";
import { evaluateGraphNode, type EvaluateGraphNodeRequest } from "../graph/evaluator.js";
import { inspectGraphNode } from "../graph/inspection.js";
import { canonicalNodeRecipe, logicalNodeId, recipeHash } from "../graph/recipes.js";
import type { GraphDatabase, NodeDraft, NodeReference } from "../graph/store.js";
import { composeTransformMatrices, invertTransformMatrix } from "../transforms.js";
import { describeFillBranch } from "./branch.js";
import { applyEffectiveMask, type FillFit } from "../mask-operations.js";

/** Recover selection intent, not a previous fit's expanded/feathered output. */
export async function prepareFillMask(
  database: GraphDatabase,
  libraryPath: string,
  request: { photoId: string; source: EvaluateGraphNodeRequest["source"] },
  selected: { contentNodeId: string; maskNodeId: string },
  fit: FillFit,
) {
  const branch = await describeFillBranch(database, request.photoId, selected.contentNodeId);
  const layerMask = await inspectGraphNode(database, {
    photoId: request.photoId,
    nodeId: selected.maskNodeId,
  });
  const ownsSelection =
    branch?.selectionNodeId &&
    layerMask.kind === "mask" &&
    layerMask.recipeVersion === 2 &&
    (layerMask.parameters as { operation?: string }).operation === "support" &&
    layerMask.inputNodeIds[0] === branch.maskNodeId;
  const selectionNodeId = ownsSelection ? branch.selectionNodeId! : selected.maskNodeId;
  const evaluated = await evaluateGraphNode({
    database,
    libraryPath,
    ...request,
    nodeId: selectionNodeId,
  });
  let mask = await readArtifactMask(evaluated.artifact.path, evaluated.artifact.artifactHash);
  const nodes: NodeDraft[] = [];
  let selection: NodeReference = { nodeId: selectionNodeId };
  let inputNodeId = selectionNodeId;
  const matrix = ownsSelection
    ? composeTransformMatrices(
        branch.currentMatrix,
        invertTransformMatrix(branch.generationInputMatrix),
      )
    : ([1, 0, 0, 1, 0, 0] as const);
  if (matrix.some((value, index) => value !== [1, 0, 0, 1, 0, 0][index])) {
    const parameters = { matrix: [...matrix] };
    nodes.push({
      localKey: "fill-selection",
      kind: "transform",
      recipeVersion: 1,
      parameters,
      inputs: [selection],
    });
    selection = { localKey: "fill-selection" };
    inputNodeId = logicalNodeId(
      recipeHash(
        canonicalNodeRecipe({
          kind: "transform",
          recipeVersion: 1,
          parameters,
          inputNodeIds: [selectionNodeId],
        }),
      ),
    );
    mask = {
      ...mask,
      data: await transformMaskPixels(mask.data, mask.w, mask.h, mask.w, mask.h, matrix),
    };
  }
  const effectiveNodeId = logicalNodeId(
    recipeHash(
      canonicalNodeRecipe({
        kind: "mask",
        recipeVersion: 2,
        parameters: fit,
        inputNodeIds: [inputNodeId],
      }),
    ),
  );
  nodes.push(
    {
      localKey: "effective-mask",
      kind: "mask",
      recipeVersion: 2,
      parameters: fit,
      inputs: [selection],
    },
    {
      localKey: "fill-support",
      kind: "mask",
      recipeVersion: 2,
      parameters: { operation: "support" },
      inputs: [{ localKey: "effective-mask" }],
    },
  );
  return { mask: await applyEffectiveMask(mask, fit), nodes, effectiveNodeId };
}
