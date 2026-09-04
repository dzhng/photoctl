import type { LibraryHandle } from "../open.js";
import { xmpStateIsStale, type ReadXmp } from "./read.js";

export async function applyImportedXmp(
  handle: LibraryHandle,
  photoId: string,
  xmp: ReadXmp,
  seedCullState: boolean,
): Promise<void> {
  if (seedCullState) await replaceCullFromXmp(handle, photoId, xmp, false);
  await recordXmpState(handle, photoId, xmp.path, xmp.mtime);
}

export async function syncXmpToPhoto(
  handle: LibraryHandle,
  photoId: string,
  xmp: ReadXmp,
): Promise<void> {
  await handle.query("BEGIN");
  try {
    await replaceCullFromXmp(handle, photoId, xmp, true);
    await recordXmpState(handle, photoId, xmp.path, xmp.mtime);
    await handle.query("COMMIT");
  } catch (error) {
    await handle.query("ROLLBACK");
    throw error;
  }
}

export async function recordXmpState(
  handle: LibraryHandle,
  photoId: string,
  sidecarPath: string,
  sidecarMtime: Date,
): Promise<void> {
  await handle.query(
    `INSERT INTO xmp_state (photo_id, sidecar_path, read_at, sidecar_mtime)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (photo_id) DO UPDATE
     SET sidecar_path = EXCLUDED.sidecar_path,
         read_at = EXCLUDED.read_at,
         sidecar_mtime = EXCLUDED.sidecar_mtime`,
    [photoId, sidecarPath, sidecarMtime.toISOString()],
  );
}

export async function countStaleXmp(handle: LibraryHandle): Promise<number> {
  return await countStalePage(handle, null, 0);
}

async function countStalePage(
  handle: LibraryHandle,
  after: string | null,
  count: number,
): Promise<number> {
  const states = await handle.query<{
    photo_id: string;
    sidecar_path: string;
    sidecar_mtime: string;
  }>(
    `SELECT photo_id::text, sidecar_path, sidecar_mtime::text
     FROM xmp_state
     WHERE ($1::uuid IS NULL OR photo_id > $1::uuid)
     ORDER BY photo_id LIMIT 128`,
    [after],
  );
  const stale = await Promise.all(
    states.rows.map(
      async (state) => await xmpStateIsStale(state.sidecar_path, state.sidecar_mtime),
    ),
  );
  const nextCount = count + stale.filter(Boolean).length;
  return states.rows.length < 128
    ? nextCount
    : await countStalePage(handle, states.rows[127].photo_id, nextCount);
}

async function replaceCullFromXmp(
  handle: LibraryHandle,
  photoId: string,
  xmp: ReadXmp,
  preserveAbsentFlag: boolean,
): Promise<void> {
  await handle.query(
    `UPDATE photos
     SET rating = $2, label = $3${xmp.flag === undefined && preserveAbsentFlag ? "" : ", flag = $4"}
     WHERE id = $1`,
    xmp.flag === undefined && preserveAbsentFlag
      ? [photoId, xmp.rating ?? 0, xmp.label ?? null]
      : [photoId, xmp.rating ?? 0, xmp.label ?? null, xmp.flag ?? "none"],
  );
  await handle.query("DELETE FROM tags WHERE photo_id = $1", [photoId]);
  if (xmp.tags.length > 0) {
    await handle.query(
      `INSERT INTO tags (photo_id, tag)
       SELECT $1, tag FROM unnest($2::text[]) AS input(tag)
       ON CONFLICT DO NOTHING`,
      [photoId, xmp.tags],
    );
  }
}
