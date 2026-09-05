import type { GraphDatabase } from "../graph/store.js";
import type { RevisionLayer } from "./model.js";

/**
 * Derives placeholder vacancy state from immutable content ancestry. A vacancy
 * remains unfilled while its first-input lineage reaches the sentinel solid,
 * even if transforms or other local nodes have been layered above it.
 */
export async function unfilledVacancyLayerIds(
  database: GraphDatabase,
  photoId: string,
  layers: readonly RevisionLayer[],
): Promise<Set<string>> {
  const vacancies = layers.filter(({ role }) => role === "vacancy");
  if (vacancies.length === 0) return new Set();
  const result = await database.query<{ layer_id: string }>(
    `WITH RECURSIVE lineage(layer_id, node_id) AS (
       SELECT seed.layer_id, seed.node_id
       FROM unnest($2::text[], $3::text[]) AS seed(layer_id, node_id)
       UNION ALL
       SELECT lineage.layer_id, edge.input_node_id
       FROM lineage
       JOIN image_node_inputs AS edge
         ON edge.photo_id = $1
        AND edge.node_id = lineage.node_id
        AND edge.input_index = 0
     )
     SELECT DISTINCT lineage.layer_id
     FROM lineage
     JOIN image_nodes AS node ON node.photo_id = $1 AND node.id = lineage.node_id
     WHERE node.kind = 'solid'`,
    [photoId, vacancies.map(({ id }) => id), vacancies.map(({ contentNodeId }) => contentNodeId)],
  );
  return new Set(result.rows.map(({ layer_id }) => layer_id));
}
