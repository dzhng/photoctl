import type { RevisionLayerDraft } from "../layers/model.js";
import type { CommitRevisionRequest, NodeReference } from "./store.js";

/** Photographic output only; the revision owner applies final vector markup atomically. */
export function planPhotographicOutput(
  base: NodeReference,
  layers: readonly RevisionLayerDraft[],
): Pick<CommitRevisionRequest, "nodes" | "rootUpdates"> {
  // An empty stack preserves base identity; a disabled stack still has a composite recipe.
  if (layers.length === 0) {
    return { nodes: [], rootUpdates: [{ root: "output", node: base }] };
  }
  return {
    nodes: [
      {
        localKey: "photographic-output",
        kind: "composite",
        recipeVersion: 2,
        ...compositeV2Projection(base, layers),
      },
    ],
    rootUpdates: [{ root: "output", node: { localKey: "photographic-output" } }],
  };
}

export function compositeV2Projection<Reference = NodeReference>(
  base: Reference,
  layers: readonly {
    contentNode: Reference;
    maskNode: Reference;
    opacity: number;
    blend: "normal";
    enabled: boolean;
  }[],
): { parameters: { layers: Array<{ opacity: number; blend: "normal" }> }; inputs: Reference[] } {
  const enabled = layers.filter((layer) => layer.enabled);
  return {
    parameters: {
      layers: enabled.map(({ opacity, blend }) => ({ opacity, blend })),
    },
    inputs: [base, ...enabled.flatMap(({ contentNode, maskNode }) => [contentNode, maskNode])],
  };
}
