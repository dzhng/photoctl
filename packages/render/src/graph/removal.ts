import type { GraphTransaction } from "./store.js";

/** Clear selected photo graphs inside the caller's photo-removal transaction; artifacts and attempts are library-owned. */
export async function deletePhotoGraphs(
  transaction: GraphTransaction,
  photoIds: string[],
): Promise<void> {
  await transaction.query("DELETE FROM photo_documents WHERE photo_id = ANY($1::uuid[])", [
    photoIds,
  ]);
  await transaction.query("DELETE FROM document_revision_roots WHERE photo_id = ANY($1::uuid[])", [
    photoIds,
  ]);
  await transaction.query("DELETE FROM document_revision_layers WHERE photo_id = ANY($1::uuid[])", [
    photoIds,
  ]);
  await transaction.query("DELETE FROM layers WHERE photo_id = ANY($1::uuid[])", [photoIds]);
  await transaction.query("DELETE FROM image_node_inputs WHERE photo_id = ANY($1::uuid[])", [
    photoIds,
  ]);
  await transaction.query("DELETE FROM document_revisions WHERE photo_id = ANY($1::uuid[])", [
    photoIds,
  ]);
  await transaction.query("DELETE FROM image_nodes WHERE photo_id = ANY($1::uuid[])", [photoIds]);
}
