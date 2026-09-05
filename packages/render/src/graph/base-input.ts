import { developDictSchema, type DevelopDict } from "../develop/dict.js";
import type { GraphTransaction } from "./store.js";
import type { ImageNodeKind, JsonValue } from "./types.js";

export interface BaseDevelopInput {
  /** The whole immutable RGB branch beneath the editable develop node, including purchased processing. */
  developInputNodeId: string;
  outputParameters: JsonValue;
  develop: DevelopDict;
  hasDevelopNode: boolean;
}

export async function readBaseDevelopInput(
  database: GraphTransaction,
  photoId: string,
  baseOutputNodeId: string,
): Promise<BaseDevelopInput> {
  const result = await database.query<{
    output_kind: ImageNodeKind;
    output_parameters: JsonValue;
    input_id: string;
    input_kind: ImageNodeKind;
    input_parameters: JsonValue;
    develop_input_id: string | null;
  }>(
    `SELECT output.kind AS output_kind, output.parameters AS output_parameters,
       input.id AS input_id, input.kind AS input_kind, input.parameters AS input_parameters,
       develop_edge.input_node_id AS develop_input_id
     FROM image_nodes output
     JOIN image_node_inputs edge ON edge.photo_id = output.photo_id AND edge.node_id = output.id
     JOIN image_nodes input ON input.photo_id = edge.photo_id AND input.id = edge.input_node_id
     LEFT JOIN image_node_inputs develop_edge ON input.kind = 'develop'
       AND develop_edge.photo_id = input.photo_id AND develop_edge.node_id = input.id
     WHERE output.photo_id = $1 AND output.id = $2 LIMIT 2`,
    [photoId, baseOutputNodeId],
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row || row.output_kind !== "output")
    throw new Error("The active base must be an output node with one RGB input");
  if (row.input_kind === "develop" && !row.develop_input_id)
    throw new Error("The active develop node must have one RGB input");
  return {
    developInputNodeId: row.develop_input_id ?? row.input_id,
    outputParameters: row.output_parameters,
    develop: row.input_kind === "develop" ? developDictSchema.parse(row.input_parameters) : {},
    hasDevelopNode: row.input_kind === "develop",
  };
}
