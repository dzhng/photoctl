import type { JsonValue } from "../graph/types.js";
import type { NodeDraft, NodeReference } from "../graph/store.js";
import type { TransformMatrix } from "../transforms.js";
import { composeTransformMatrices } from "../transforms.js";
import type { FillBranchDescriptor } from "./branch.js";

export function rebuildFillBranch(input: {
  branch: FillBranchDescriptor;
  key: string;
  frame: { w: number; h: number };
  baseNodeId: string;
  placement: NodeReference;
  placementDimensions: { w: number; h: number };
  generationDimensions: { w: number; h: number };
  matrix: TransformMatrix;
  preserveCompensations: boolean;
}): {
  nodes: NodeDraft[];
  content: NodeReference;
  mask: NodeReference;
  compositeKey: string;
} {
  const resampleKey = `${input.key}-resample`;
  const maskKey = `${input.key}-mask-transform`;
  const compositeKey = `${input.key}-mask-composite`;
  const fromGeneration: TransformMatrix = [
    input.generationDimensions.w / input.placementDimensions.w,
    0,
    0,
    input.generationDimensions.h / input.placementDimensions.h,
    0,
    0,
  ];
  const placementMatrix = composeTransformMatrices(
    input.matrix,
    composeTransformMatrices(input.branch.generationPlacementMatrix, fromGeneration),
  );
  const nodes: NodeDraft[] = [
    {
      localKey: resampleKey,
      kind: "resample",
      recipeVersion: 2,
      parameters: {
        w: input.frame.w,
        h: input.frame.h,
        kernel: "lanczos3",
        matrix: [...placementMatrix],
      },
      inputs: [input.placement],
    },
    {
      localKey: maskKey,
      kind: "transform",
      recipeVersion: 1,
      parameters: { matrix: [...input.matrix] },
      inputs: [{ nodeId: input.branch.permanentMaskNodeId }],
    },
    {
      localKey: compositeKey,
      kind: "mask_composite",
      recipeVersion: input.branch.composite.recipeVersion,
      parameters: input.branch.composite.parameters as JsonValue,
      inputs: [{ nodeId: input.baseNodeId }, { localKey: resampleKey }, { localKey: maskKey }],
    },
  ];
  let content: NodeReference = { localKey: compositeKey };
  if (input.preserveCompensations) {
    for (const [index, compensation] of input.branch.compensations.toReversed().entries()) {
      const localKey = `${input.key}-compensation-${index}`;
      nodes.push({
        localKey,
        kind: compensation.kind,
        recipeVersion: compensation.recipeVersion,
        parameters: compensation.parameters as JsonValue,
        inputs: [content],
      });
      content = { localKey };
    }
  }
  return { nodes, content, mask: { localKey: maskKey }, compositeKey };
}
