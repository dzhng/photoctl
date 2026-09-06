import { type ShowData, PhotoctlError } from "@photoctl/protocol";
import type { EmbeddedJpeg } from "@photoctl/importer";
import type { LibraryHandle } from "@photoctl/library";
import { parseExifOrientation, type ExifOrientation } from "@photoctl/render";

export interface StoredOriginal {
  id: string;
  kind: "raw" | "jpeg" | "image";
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
  files: Array<{
    volumeUuid: string;
    relPath: string;
    lastMount: string;
    embedded: EmbeddedJpeg[];
  }>;
}
export interface StoredPhoto {
  id: string;
  primaryOriginalId: string;
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
  originals: StoredOriginal[];
}
interface OriginalRow {
  id: string;
  kind: StoredOriginal["kind"];
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
}
export async function loadPhoto(
  handle: Pick<LibraryHandle, "query">,
  id: string,
): Promise<StoredPhoto> {
  const photos = await handle.query<{
    id: string;
    primary_original_id: string;
    w: number;
    h: number;
    orientation: number;
    rating: number;
    flag: StoredPhoto["flag"];
    label: StoredPhoto["label"];
  }>(
    "SELECT id::text, primary_original_id::text, w, h, orientation, rating, flag, label FROM photos WHERE id = $1",
    [id],
  );
  const row = photos.rows[0];
  if (!row) throw new PhotoctlError("not_found", `Photo not found: ${id}`, { id });
  const sources = await handle.query<OriginalRow>(
    `SELECT id::text, kind, content_key, content_hash, size::text, w, h, orientation, camera, exposure,
            shot_at::text, shot_offset_min FROM originals WHERE photo_id = $1 ORDER BY (id = $2) DESC, id`,
    [id, row.primary_original_id],
  );
  const files = await handle.query<{
    original_id: string;
    volume_uuid: string;
    rel_path: string;
    last_mount: string;
    embedded: EmbeddedJpeg[];
  }>(
    `SELECT f.original_id::text, f.volume_uuid, f.rel_path, f.embedded, v.last_mount
      FROM files f JOIN originals o ON o.id = f.original_id JOIN volumes v ON v.uuid = f.volume_uuid
      WHERE o.photo_id = $1 ORDER BY f.id`,
    [id],
  );
  const originals: StoredOriginal[] = sources.rows.map((source) => ({
    id: source.id,
    kind: source.kind,
    contentKey: source.content_key,
    contentHash: source.content_hash,
    size: Number(source.size),
    w: source.w,
    h: source.h,
    orientation: parseExifOrientation(source.orientation),
    camera: {
      make: source.camera.make ?? null,
      model: source.camera.model ?? null,
      lens: source.camera.lens ?? null,
    },
    exposure: {
      shutter: source.exposure.shutter ?? null,
      f: source.exposure.f ?? null,
      iso: source.exposure.iso ?? null,
      focal_mm: source.exposure.focal_mm ?? null,
      wb: source.exposure.wb ?? null,
    },
    shotAt: source.shot_at,
    shotOffsetMin: source.shot_offset_min,
    files: files.rows
      .filter((file) => file.original_id === source.id)
      .map((file) => ({
        volumeUuid: file.volume_uuid,
        relPath: file.rel_path,
        lastMount: file.last_mount,
        embedded: file.embedded,
      })),
  }));
  const primary = originals.find((original) => original.id === row.primary_original_id)!;
  return {
    id: row.id,
    primaryOriginalId: row.primary_original_id,
    w: row.w,
    h: row.h,
    orientation: parseExifOrientation(row.orientation),
    camera: primary.camera,
    exposure: primary.exposure,
    shotAt: primary.shotAt,
    shotOffsetMin: primary.shotOffsetMin,
    rating: row.rating,
    flag: row.flag,
    label: row.label,
    originals,
  };
}
