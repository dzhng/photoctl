import { z } from "zod";
import { developDictSchema } from "../develop/dict.js";
import { savedFrameSchema } from "./frame.js";
import type { GraphTransaction } from "./store.js";

const activation = {
  sequence: z.number().int().nonnegative(),
  crop_activation: z.number().int().nonnegative(),
  aspect_activation: z.number().int().nonnegative(),
};

export const geometryNodeParametersSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("intent"), ...activation }).strict(),
    z
      .object({
        type: z.literal("checkpoint"),
        ...activation,
        sequence: z.number().int().positive(),
        support_input_count: z.number().int().nonnegative(),
        geometry: developDictSchema.pick({
          crop: true,
          aspect_ratio: true,
          rotate: true,
          straighten_deg: true,
        }),
        input_frame: savedFrameSchema,
        input_stages: z.array(savedFrameSchema),
        outer_frame: savedFrameSchema,
      })
      .strict(),
  ])
  .refine(
    (value) => value.crop_activation <= value.sequence && value.aspect_activation <= value.sequence,
    "Geometry activation cannot be newer than its authored checkpoint sequence",
  );

/** Metadata ancestry contains only immutable checkpoints, never historical image dependencies. */
export async function loadGeometryAncestry(
  database: GraphTransaction,
  photoId: string,
  rootId: string,
) {
  const rows = (
    await database.query<{ id: string; kind: string; parameters: unknown; input_ids: string[] }>(
      `WITH RECURSIVE reachable(node_id) AS (
       VALUES ($2::text)
       UNION SELECT edge.input_node_id FROM image_node_inputs edge
       JOIN reachable ON reachable.node_id = edge.node_id WHERE edge.photo_id = $1
     )
     SELECT node.id, node.kind, node.parameters,
       ARRAY(SELECT edge.input_node_id FROM image_node_inputs edge
             WHERE edge.photo_id = $1 AND edge.node_id = node.id ORDER BY edge.input_index) AS input_ids
     FROM reachable JOIN image_nodes node ON node.photo_id = $1 AND node.id = reachable.node_id`,
      [photoId, rootId],
    )
  ).rows;
  const nodes = new Map(
    rows.map((row) => {
      if (row.kind !== "geometry")
        throw new Error("Geometry ancestry cannot depend on pixel nodes");
      return [
        row.id,
        { parameters: geometryNodeParametersSchema.parse(row.parameters), inputs: row.input_ids },
      ] as const;
    }),
  );
  const root = nodes.get(rootId);
  if (!root) throw new Error("Geometry ancestry is missing its root");
  for (const node of nodes.values()) {
    if (node.parameters.type === "checkpoint") {
      const head = node.inputs[node.parameters.support_input_count];
      if (
        (node.parameters.sequence === 1 && head !== undefined) ||
        (node.parameters.sequence > 1 &&
          nodes.get(head ?? "")?.parameters.sequence !== node.parameters.sequence - 1)
      ) {
        throw new Error(
          "An authored checkpoint must retain its preceding chronological checkpoint",
        );
      }
    }
    if (
      node.parameters.type === "checkpoint" &&
      (node.parameters.support_input_count > node.inputs.length ||
        node.inputs.length - node.parameters.support_input_count > 1)
    ) {
      throw new Error(
        "Checkpoint inputs must contain supporting checkpoints and at most one chronological head",
      );
    }
    for (const inputId of node.inputs) {
      const input = nodes.get(inputId);
      if (
        input?.parameters.type !== "checkpoint" ||
        input.parameters.sequence > node.parameters.sequence ||
        (node.parameters.type === "checkpoint" &&
          input.parameters.sequence === node.parameters.sequence)
      ) {
        throw new Error("Geometry ancestry must follow earlier authored checkpoints");
      }
    }
  }
  if (root.parameters.type === "intent") {
    if (
      root.inputs.length > 1 ||
      (root.inputs.length === 0 && root.parameters.sequence !== 0) ||
      (root.inputs[0] &&
        nodes.get(root.inputs[0])!.parameters.sequence !== root.parameters.sequence)
    ) {
      throw new Error("Geometry intent must retain its latest authored checkpoint");
    }
  }
  return { nodeId: rootId, ...root, nodes };
}
