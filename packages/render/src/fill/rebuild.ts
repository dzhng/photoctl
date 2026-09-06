import type { JsonValue } from "../graph/types.js";
import type { NodeDraft, NodeReference } from "../graph/store.js";
import type { TransformMatrix } from "../transforms.js";
import { composeTransformMatrices, invertTransformMatrix } from "../transforms.js";
import type { FillBranchDescriptor } from "./branch.js";
import { frameAtRaster, parseRenderFrame, placedFrame, savedRenderFrame } from "../graph/frame.js";

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
  effectiveMask?: NodeReference;
}): {
  nodes: NodeDraft[];
  content: NodeReference;
  mask: NodeReference;
  compositeKey?: string;
} {
  const resampleKey = `${input.key}-resample`;
  const maskKey = `${input.key}-mask-transform`;
  const compositeKey = `${input.key}-mask-composite`;
  const supportKey = `${input.key}-mask-support`;
  if (input.branch.outpaint) {
    const placementKey = `${input.key}-placement`;
    const frame = parseRenderFrame(input.branch.outpaint.output_frame);
    const nodes: NodeDraft[] = [
      {
        localKey: placementKey,
        kind: "transform",
        recipeVersion: 2,
        parameters: {
          matrix: [...input.matrix],
          frame: savedRenderFrame(
            placedFrame(frameAtRaster(frame, input.placementDimensions), input.matrix),
          ),
        },
        inputs: [input.placement],
      },
      {
        localKey: maskKey,
        kind: "transform",
        recipeVersion: 2,
        parameters: {
          matrix: [...input.matrix],
          frame: savedRenderFrame(placedFrame(frame, input.matrix)),
        },
        inputs: [{ nodeId: input.branch.permanentMaskNodeId }],
      },
    ];
    let content: NodeReference = { localKey: placementKey };
    for (const [index, descendant] of input.branch.descendants.toReversed().entries()) {
      if (descendant.kind !== "delta" || !input.preserveCompensations) continue;
      const localKey = `${input.key}-placement-${index}`;
      nodes.push({
        localKey,
        kind: descendant.kind,
        recipeVersion: descendant.recipeVersion,
        parameters: descendant.parameters as JsonValue,
        inputs: [content],
      });
      content = { localKey };
    }
    return { nodes, content, mask: { localKey: maskKey } };
  }
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
      parameters: {
        matrix: [
          ...(input.branch.fit
            ? composeTransformMatrices(
                input.matrix,
                invertTransformMatrix(input.branch.generationInputMatrix),
              )
            : input.matrix),
        ],
      },
      inputs: [input.effectiveMask ?? { nodeId: input.branch.permanentMaskNodeId }],
    },
    {
      localKey: supportKey,
      kind: "mask",
      recipeVersion: 2,
      parameters: { operation: "support" },
      inputs: [{ localKey: maskKey }],
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
  return { nodes, content, mask: { localKey: supportKey }, compositeKey };
}
