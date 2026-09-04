import { cacheRootForLibrary, formatShotInstant, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import {
  createVolumeResolver,
  DirTrash,
  MacTrash,
  stageFileRemoval,
  xmpStateIsStale,
  type LibraryHandle,
  type TrashReceipt,
} from "@photoctl/library";
import {
  PhotoctlError,
  type CullFlag,
  type CullLabel,
  type Envelope,
  type ListData,
  type ListRow,
  type NextData,
  type Warning,
} from "@photoctl/protocol";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArguments } from "../arguments.js";
import { batchEnvelope, resolveBatchInputs } from "../batch.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";

export async function rateCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, { options: ["--stars"] });
  const stars = Number(parsed.options.get("--stars"));
  if (parsed.positionals.length === 0 || !Number.isInteger(stars) || stars < 0 || stars > 5) {
    throw new PhotoctlError("usage", "rate requires photo IDs and --stars 0..5");
  }
  return await updateCull(parsed.positionals, env, cwd, provided, "rating", stars);
}

export async function flagCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, { flags: ["--pick", "--reject", "--none"] });
  if (parsed.positionals.length === 0 || parsed.flags.size !== 1) {
    throw new PhotoctlError("usage", "flag requires photo IDs and exactly one flag state");
  }
  const flag = [...parsed.flags][0].slice(2) as CullFlag;
  return await updateCull(parsed.positionals, env, cwd, provided, "flag", flag);
}

export async function labelCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, {});
  const value = parsed.positionals.at(-1)?.toLowerCase();
  const ids = parsed.positionals.slice(0, -1);
  if (
    ids.length === 0 ||
    value === undefined ||
    !["red", "yellow", "green", "blue", "purple", "none"].includes(value)
  ) {
    throw new PhotoctlError(
      "usage",
      "label requires photo IDs and red|yellow|green|blue|purple|none",
    );
  }
  return await updateCull(
    ids,
    env,
    cwd,
    provided,
    "label",
    value === "none" ? null : (value as CullLabel),
  );
}

async function updateCull(
  inputs: string[],
  env: RequestEnv,
  cwd: string,
  provided: LibraryHandle | undefined,
  column: "rating" | "flag" | "label",
  value: number | string | null,
): Promise<Envelope> {
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const resolved = await resolveBatchInputs(lease.handle, inputs);
    const ids = resolved.filter((item) => item.ok).map((item) => item.id);
    if (ids.length > 0) {
      await lease.handle.query(`UPDATE photos SET ${column} = $2 WHERE id = ANY($1::uuid[])`, [
        ids,
        value,
      ]);
    }
    const results = resolved.map((item) => (item.ok ? { id: item.id, ok: true as const } : item));
    return batchEnvelope(results);
  } finally {
    await lease.release();
  }
}

export async function listCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  stream?: (row: ListRow) => void | Promise<void>,
): Promise<Envelope<ListData>> {
  const parsed = parseArguments(args, {
    flags: ["--xmp-stale", "--stream"],
    options: ["--rating", "--flag", "--label", "--tag", "--folder", "--limit"],
  });
  if (parsed.positionals.length > 0) {
    throw new PhotoctlError("usage", `Unexpected argument: ${parsed.positionals[0]}`);
  }
  const rating = parsed.options.get("--rating");
  const flag = parsed.options.get("--flag");
  const label = parsed.options.get("--label");
  const limitValue = parsed.options.get("--limit");
  const limit = limitValue === undefined ? undefined : Number(limitValue);
  if (rating !== undefined) parseRatingFilter(rating);
  if (flag !== undefined && !["pick", "reject", "none"].includes(flag)) {
    throw new PhotoctlError("usage", "--flag must be pick, reject, or none");
  }
  if (
    label !== undefined &&
    !["red", "yellow", "green", "blue", "purple", "none"].includes(label)
  ) {
    throw new PhotoctlError("usage", "--label must be a color or none");
  }
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new PhotoctlError("usage", "--limit must be a positive integer");
  }

  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const streaming = parsed.flags.has("--stream");
    const loaded = await loadListRows(
      lease.handle,
      env,
      {
        rating,
        flag: flag as CullFlag | undefined,
        label: label === "none" ? null : (label as CullLabel | undefined),
        tag: parsed.options.get("--tag"),
        folder: parsed.options.get("--folder"),
        xmpStale: parsed.flags.has("--xmp-stale"),
      },
      {
        maxRows: streaming ? 0 : limit,
        visit: streaming ? stream : undefined,
        visitLimit: limit,
      },
    );
    return {
      schema: 1,
      ok: true,
      data: { rows: loaded.rows, total: loaded.total },
      warnings: [],
    };
  } finally {
    await lease.release();
  }
}

export async function nextCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope<NextData>> {
  const parsed = parseArguments(args, {
    flags: ["--unrated", "--unflagged", "--reset"],
    options: ["--folder"],
  });
  if (parsed.positionals.length > 0) {
    throw new PhotoctlError("usage", `Unexpected argument: ${parsed.positionals[0]}`);
  }
  const filters = {
    unrated: parsed.flags.has("--unrated"),
    unflagged: parsed.flags.has("--unflagged"),
    folder: parsed.options.get("--folder") ?? null,
  };
  const cursorKey = `next_cursor:${createHash("sha256")
    .update(JSON.stringify(filters))
    .digest("hex")}`;
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    if (parsed.flags.has("--reset")) {
      await lease.handle.query("DELETE FROM settings WHERE key = $1", [cursorKey]);
    }
    const { rows, order } = await loadListRows(
      lease.handle,
      env,
      {
        ...(filters.unrated ? { rating: "0" } : {}),
        ...(filters.unflagged ? { flag: "none" as const } : {}),
        ...(filters.folder ? { folder: filters.folder } : {}),
        xmpStale: false,
      },
      { captureOrder: true },
    );
    if (rows.length === 0) throw new PhotoctlError("not_found", "No photos match the next filter");
    const cursor = await lease.handle.query<{ value: unknown }>(
      "SELECT value FROM settings WHERE key = $1",
      [cursorKey],
    );
    const previous = parseNextCursor(cursor.rows[0]?.value);
    const index = previous ? order.findIndex((candidate) => orderAfter(candidate, previous)) : 0;
    if (index < 0 || index >= rows.length) {
      throw new PhotoctlError("not_found", "No photos remain for this next cursor");
    }
    const row = rows[index];
    const cacheRoot = cacheRootForLibrary(await readLibraryId(lease.handle), cacheBase(env, cwd));
    const preview = pinnedEmbeddedJpegPath(cacheRoot, row.id);
    try {
      await access(preview);
    } catch {
      throw new PhotoctlError("file_offline", "Pinned preview is unavailable", { id: row.id });
    }
    await lease.handle.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [cursorKey, JSON.stringify(order[index])],
    );
    return {
      schema: 1,
      ok: true,
      data: { ...row, preview, remaining: rows.length - index - 1 },
      warnings: [],
    };
  } finally {
    await lease.release();
  }
}

export async function removeCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, { flags: ["--from-disk", "--yes"] });
  if (parsed.positionals.length === 0) {
    throw new PhotoctlError("usage", "remove requires at least one photo ID");
  }
  const fromDisk = parsed.flags.has("--from-disk");
  if (parsed.positionals.length > 1 && !parsed.flags.has("--yes")) {
    throw new PhotoctlError("usage", "removing several photos requires --yes");
  }
  const lease = await openRequestLibrary(env, cwd, provided);
  const receipts: TrashReceipt[] = [];
  let databaseCommitted = false;
  try {
    const resolved = await resolveBatchInputs(lease.handle, parsed.positionals);
    const ids = resolved.filter((item) => item.ok).map((item) => item.id);
    const warnings: Warning[] = [];
    const resolver = createVolumeResolver(env.volumeMap, lease.handle.path);
    if (fromDisk) {
      const files = await lease.handle.query<{
        photo_id: string;
        volume_uuid: string;
        rel_path: string;
      }>(
        `SELECT photo_id::text, volume_uuid, rel_path
         FROM files WHERE photo_id = ANY($1::uuid[]) ORDER BY photo_id, rel_path`,
        [ids],
      );
      for (const file of files.rows) {
        const located = await resolver.resolve(file.volume_uuid, file.rel_path);
        if (!located.online || !located.path || !located.mount) {
          warnings.push({
            code: "source_offline",
            id: file.photo_id,
            message: "The offline source was removed from the catalog but not from disk",
          });
          continue;
        }
        receipts.push(
          await (env.volumeMap ? new DirTrash(located.mount) : new MacTrash(located.mount)).move(
            located.path,
          ),
        );
      }
    }
    const cacheRoot = cacheRootForLibrary(await readLibraryId(lease.handle), cacheBase(env, cwd));
    for (const id of ids) {
      const staged = await stageFileRemoval(pinnedEmbeddedJpegPath(cacheRoot, id));
      if (staged) receipts.push(staged);
      const views = await stageFileRemoval(join(cacheRoot, "view", id));
      if (views) receipts.push(views);
    }
    await lease.handle.query("BEGIN");
    try {
      await lease.handle.query("DELETE FROM photos WHERE id = ANY($1::uuid[])", [ids]);
      await lease.handle.query(
        `DELETE FROM cache_index
         WHERE path = ANY($1::text[])
            OR path LIKE ANY($2::text[])`,
        [ids.map((id) => `emb/${id}.jpg`), ids.map((id) => `view/${id}/%`)],
      );
      await lease.handle.query("COMMIT");
      databaseCommitted = true;
    } catch (error) {
      await lease.handle.query("ROLLBACK");
      throw error;
    }
    for (const receipt of receipts) await receipt.commit().catch(() => undefined);
    const results = resolved.map((item) => (item.ok ? { id: item.id, ok: true as const } : item));
    const envelope = batchEnvelope(results);
    return { ...envelope, warnings: [...(envelope.warnings ?? []), ...warnings] };
  } catch (error) {
    if (!databaseCommitted) {
      await rollbackReceiptsOrThrow(receipts, error);
    }
    throw error;
  } finally {
    await lease.release();
  }
}

export async function rollbackReceiptsOrThrow(
  receipts: TrashReceipt[],
  cause: unknown,
): Promise<void> {
  const rollbackFailures: Array<{ path: string; message: string }> = [];
  for (const receipt of receipts.toReversed()) {
    try {
      await receipt.rollback();
    } catch (error) {
      rollbackFailures.push({
        path: receipt.original,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (rollbackFailures.length > 0) {
    throw new PhotoctlError("volume_readonly", "Removal failed and could not restore every file", {
      rollback_failures: rollbackFailures,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

interface RawListRow {
  id: string;
  rating: number;
  flag: CullFlag;
  label: CullLabel | null;
  shot_at: string | null;
  shot_order: number | null;
  shot_offset_min: number | null;
  sidecar_path: string | null;
  sidecar_mtime: string | null;
}

interface ListOrder {
  shotAt: number | null;
  id: string;
}

interface RawLocatorRow {
  photo_id: string;
  volume_uuid: string;
  rel_path: string;
}

async function loadListRows(
  handle: LibraryHandle,
  env: RequestEnv,
  filters: {
    rating?: string;
    flag?: CullFlag;
    label?: CullLabel | null;
    tag?: string;
    folder?: string;
    xmpStale: boolean;
  },
  output: {
    maxRows?: number;
    visit?: (row: ListRow) => void | Promise<void>;
    visitLimit?: number;
    captureOrder?: boolean;
  } = {},
): Promise<{ rows: ListRow[]; total: number; order: ListOrder[] }> {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  if (filters.rating) where.push(ratingSql(filters.rating, add));
  if (filters.flag) where.push(`p.flag = ${add(filters.flag)}`);
  if (filters.label !== undefined) {
    where.push(filters.label === null ? "p.label IS NULL" : `p.label = ${add(filters.label)}`);
  }
  if (filters.tag) {
    where.push(
      `EXISTS (SELECT 1 FROM tags t WHERE t.photo_id = p.id AND t.tag = ${add(filters.tag)})`,
    );
  }
  if (filters.folder) {
    const folder = add(
      filters.folder
        .replaceAll("\\", "/")
        .replace(/^\/+|\/+$/g, "")
        .replace(/([%_])/g, "\\$1"),
    );
    where.push(
      `EXISTS (SELECT 1 FROM files ff WHERE ff.photo_id = p.id
               AND (ff.rel_path LIKE ${folder} || '/%' ESCAPE E'\\\\'
                    OR ff.rel_path LIKE '%/' || ${folder} || '/%' ESCAPE E'\\\\'))`,
    );
  }
  if (filters.xmpStale) where.push("xs.photo_id IS NOT NULL");
  const resolver = createVolumeResolver(env.volumeMap, handle.path);
  const rows: ListRow[] = [];
  const order: ListOrder[] = [];
  let total = 0;
  let visited = 0;
  let offset = 0;
  const pageSize = 64;
  while (true) {
    const photos = await handle.query<RawListRow>(
      `SELECT p.id::text, p.rating, p.flag, p.label, p.shot_at::text,
              extract(epoch FROM p.shot_at)::double precision AS shot_order, p.shot_offset_min,
              xs.sidecar_path, xs.sidecar_mtime::text
       FROM photos p
       LEFT JOIN xmp_state xs ON xs.photo_id = p.id
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY p.shot_at NULLS LAST, p.id
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    );
    if (photos.rows.length === 0) break;
    const photoIds = photos.rows.map((row) => row.id);
    const locators = await handle.query<RawLocatorRow>(
      `SELECT photo_id::text, volume_uuid, rel_path
       FROM files WHERE photo_id = ANY($1::uuid[]) ORDER BY photo_id, rel_path`,
      [photoIds],
    );
    const located = await Promise.all(
      locators.rows.map(async (row) => ({
        source: row,
        online: (await resolver.resolve(row.volume_uuid, row.rel_path)).online,
      })),
    );
    const byPhoto = new Map<string, typeof located>();
    for (const item of located) {
      const group = byPhoto.get(item.source.photo_id) ?? [];
      group.push(item);
      byPhoto.set(item.source.photo_id, group);
    }
    for (const photo of photos.rows) {
      const group = byPhoto.get(photo.id);
      if (!group || group.length === 0) continue;
      const selected = group.find((item) => item.online) ?? group[0];
      if (
        filters.xmpStale &&
        photo.sidecar_path &&
        photo.sidecar_mtime &&
        !(await xmpStateIsStale(photo.sidecar_path, photo.sidecar_mtime))
      ) {
        continue;
      }
      const row: ListRow = {
        id: photo.id,
        file: basename(selected.source.rel_path),
        rating: photo.rating,
        flag: photo.flag,
        label: photo.label,
        shot:
          photo.shot_at && photo.shot_offset_min !== null
            ? formatShotInstant(new Date(photo.shot_at), photo.shot_offset_min)
            : null,
        online: group.some((item) => item.online),
      };
      total += 1;
      if (rows.length < (output.maxRows ?? Number.POSITIVE_INFINITY)) rows.push(row);
      if (output.captureOrder) order.push({ shotAt: photo.shot_order, id: photo.id });
      if (output.visit && visited < (output.visitLimit ?? Number.POSITIVE_INFINITY)) {
        await output.visit(row);
        visited += 1;
      }
    }
    offset += photos.rows.length;
    if (photos.rows.length < pageSize) break;
  }
  return { rows, total, order };
}

function parseNextCursor(value: unknown): ListOrder | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<ListOrder>;
  if (typeof candidate.id !== "string") return null;
  if (candidate.shotAt !== null && typeof candidate.shotAt !== "number") return null;
  return { id: candidate.id, shotAt: candidate.shotAt ?? null };
}

function orderAfter(candidate: ListOrder, cursor: ListOrder): boolean {
  if (cursor.shotAt === null) {
    return candidate.shotAt === null && candidate.id > cursor.id;
  }
  if (candidate.shotAt === null) return true;
  return candidate.shotAt === cursor.shotAt
    ? candidate.id > cursor.id
    : candidate.shotAt > cursor.shotAt;
}

function parseRatingFilter(value: string): void {
  if (/^[0-5]$/.test(value) || /^(>=|<=|>|<)[0-5]$/.test(value)) return;
  const range = /^([0-5])\.\.([0-5])$/.exec(value);
  if (range && Number(range[1]) <= Number(range[2])) return;
  throw new PhotoctlError("usage", "--rating must be N, >=N, <=N, >N, <N, or N..N within 0..5");
}

function ratingSql(value: string, add: (value: unknown) => string): string {
  const range = /^([0-5])\.\.([0-5])$/.exec(value);
  if (range) return `p.rating BETWEEN ${add(Number(range[1]))} AND ${add(Number(range[2]))}`;
  const comparison = /^(>=|<=|>|<)([0-5])$/.exec(value);
  if (comparison) return `p.rating ${comparison[1]} ${add(Number(comparison[2]))}`;
  return `p.rating = ${add(Number(value))}`;
}
