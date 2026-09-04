import { type ShowData, PhotoctlError } from "@photoctl/protocol";
import type { EmbeddedJpeg } from "@photoctl/importer";
import type { LibraryHandle } from "@photoctl/library";
import { parseExifOrientation, type ExifOrientation } from "@photoctl/render";

interface PhotoRow {
  id: string;
  content_key: string;
  content_hash: string | null;
  size: string;
  w: number;
  h: number;
  orientation: number;
  camera: ShowData["camera"];
  exposure: ShowData["exposure"];
  shot_at: string | null;
  shot_offset_min: number | null;
  rating: number;
  flag: StoredPhoto["flag"];
  label: StoredPhoto["label"];
}

interface FileRow {
  volume_uuid: string;
  rel_path: string;
  last_mount: string;
  embedded: EmbeddedJpeg[];
}

export interface StoredPhoto {
  id: string;
  contentKey: string;
  contentHash: string | null;
  size: number;
  w: number;
  h: number;
  orientation: ExifOrientation;
  camera: ShowData["camera"];
  exposure: ShowData["exposure"];
  shotAt: string | null;
  shotOffsetMin: number | null;
  rating: number;
  flag: "pick" | "reject" | "none";
  label: "red" | "yellow" | "green" | "blue" | "purple" | null;
  files: Array<{
    volumeUuid: string;
    relPath: string;
    lastMount: string;
    embedded: EmbeddedJpeg[];
  }>;
}

export async function loadPhoto(
  handle: Pick<LibraryHandle, "query">,
  id: string,
): Promise<StoredPhoto> {
  const photos = await handle.query<PhotoRow>(
    `SELECT id::text, content_key, content_hash, size::text, w, h, orientation, camera, exposure,
            shot_at::text, shot_offset_min, rating, flag, label
     FROM photos WHERE id = $1`,
    [id],
  );
  const row = photos.rows[0];
  if (!row) throw new PhotoctlError("not_found", `Photo not found: ${id}`, { id });
  const files = await handle.query<FileRow>(
    `SELECT f.volume_uuid, f.rel_path, f.embedded, v.last_mount
     FROM files f JOIN volumes v ON v.uuid = f.volume_uuid
     WHERE f.photo_id = $1 ORDER BY f.id`,
    [id],
  );
  return {
    id: row.id,
    contentKey: row.content_key,
    contentHash: row.content_hash,
    size: Number(row.size),
    w: row.w,
    h: row.h,
    orientation: parseExifOrientation(row.orientation),
    camera: {
      make: row.camera.make ?? null,
      model: row.camera.model ?? null,
      lens: row.camera.lens ?? null,
    },
    exposure: {
      shutter: row.exposure.shutter ?? null,
      f: row.exposure.f ?? null,
      iso: row.exposure.iso ?? null,
      focal_mm: row.exposure.focal_mm ?? null,
      wb: row.exposure.wb ?? null,
    },
    shotAt: row.shot_at,
    shotOffsetMin: row.shot_offset_min,
    rating: row.rating,
    flag: row.flag,
    label: row.label,
    files: files.rows.map((file) => ({
      volumeUuid: file.volume_uuid,
      relPath: file.rel_path,
      lastMount: file.last_mount,
      embedded: file.embedded,
    })),
  };
}
