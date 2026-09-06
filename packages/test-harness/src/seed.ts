import { newLibraryEntityId, openLibrary } from "@photoctl/library";

export async function seedPhotoRows(libraryPath: string, count: number): Promise<string[]> {
  const handle = await openLibrary(libraryPath);
  const ids = Array.from({ length: count }, () => newLibraryEntityId());
  try {
    await handle.query("BEGIN");
    try {
      for (const [index, id] of ids.entries()) {
        await handle.query(
          `WITH inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation)
             VALUES ($1, $1, 1, 1, 1) RETURNING id)
           INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation)
           VALUES ($1, $1, 'image', $2, 1, 1, 1, 1)`,
          [id, `test_${index}_${id}`],
        );
      }
      await handle.query("COMMIT");
    } catch (error) {
      await handle.query("ROLLBACK");
      throw error;
    }
    return ids;
  } finally {
    await handle.close();
  }
}
