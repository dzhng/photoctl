import { newLibraryEntityId, openLibrary } from "@photoctl/library";

export async function seedPhotoRows(libraryPath: string, count: number): Promise<string[]> {
  const handle = await openLibrary(libraryPath);
  const ids = Array.from({ length: count }, () => newLibraryEntityId());
  try {
    await handle.query("BEGIN");
    try {
      for (const [index, id] of ids.entries()) {
        await handle.query(
          `INSERT INTO photos
             (id, content_key, size, w, h, orientation, camera, exposure)
           VALUES ($1, $2, 1, 1, 1, 1, '{}'::jsonb, '{}'::jsonb)`,
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
