import { commitRevision, type GraphDatabase } from "../graph/store.js";
import { markupDocumentSchema, type MarkupDocument } from "@photoctl/protocol";

export async function readMarkupDocument(
  database: GraphDatabase,
  photoId: string,
): Promise<MarkupDocument> {
  const result = await database.query<{ items: unknown }>(
    "SELECT items FROM markup WHERE photo_id = $1",
    [photoId],
  );
  return markupDocumentSchema.parse(result.rows[0]?.items ?? []);
}

export async function replaceMarkupDocument(
  database: GraphDatabase,
  photoId: string,
  expectedRevisionId: string,
  document: MarkupDocument,
) {
  const committed = await commitRevision(database, {
    photoId,
    expectedRevisionId,
    nodes: [],
    rootUpdates: [],
    markupDocument: markupDocumentSchema.parse(document),
  });
  if (!committed.renderHash) throw new Error("A markup revision requires an output render hash");
  return {
    revisionId: committed.revisionId,
    renderHash: committed.renderHash as `r_${string}`,
    nodeId: committed.roots.output! as `node_${string}`,
  };
}
