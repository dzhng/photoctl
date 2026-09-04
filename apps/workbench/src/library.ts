import { openLibrary } from "@photoctl/library";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface LibraryEvidence {
  library: string;
  libraryId: string;
  schemaVersion: number;
  cacheBytes: number;
  tables: Array<{ name: string; rows: number }>;
  backups: Array<{ name: string; bytes: number }>;
}

export async function inspectLibrary(path: string): Promise<LibraryEvidence> {
  const library = await openLibrary(path);
  try {
    const [identity, version, tableNames, cache] = await Promise.all([
      library.query<{ value: string }>(
        "SELECT value #>> '{}' AS value FROM settings WHERE key = 'library_id'",
      ),
      library.query<{ version: number }>(
        "SELECT max(version)::integer AS version FROM schema_version",
      ),
      library.query<{ name: string }>(
        "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      ),
      library.query<{ bytes: string }>(
        "SELECT coalesce(sum(bytes), 0)::text AS bytes FROM cache_index",
      ),
    ]);
    const tables = await Promise.all(
      tableNames.rows.map(async ({ name }) => {
        const countResult = await library.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM "${name.replaceAll('"', '""')}"`,
        );
        return { name, rows: Number(countResult.rows[0]?.count ?? 0) };
      }),
    );
    return {
      library: library.path,
      libraryId: identity.rows[0]?.value ?? "unknown",
      schemaVersion: version.rows[0]?.version ?? 0,
      cacheBytes: Number(cache.rows[0]?.bytes ?? 0),
      tables,
      backups: await inspectBackups(library.path),
    };
  } finally {
    await library.close();
  }
}

export function renderLibraryReport(evidence: LibraryEvidence): string {
  const tableRows = evidence.tables
    .map(({ name, rows }) => `<tr><td>${escapeHtml(name)}</td><td>${rows}</td></tr>`)
    .join("");
  const backups = evidence.backups.length
    ? evidence.backups
        .map(
          ({ name, bytes }) =>
            `<li><code>${escapeHtml(name)}</code><strong>${formatBytes(bytes)}</strong></li>`,
        )
        .join("")
    : "<li><code>none</code><strong>0 B</strong></li>";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>photoctl library workbench</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#0b0e14;color:#edf1f7}main{width:min(900px,calc(100% - 40px));margin:auto;padding:64px 0 80px}.eyebrow,.label{color:#aeb9c9;font-size:12px;text-transform:uppercase}.identity{margin-top:28px}.identity h1{margin:8px 0 18px;font:700 36px/1.15 ui-monospace,monospace;overflow-wrap:anywhere}.path{margin:7px 0 0;color:#c7d0dd;overflow-wrap:anywhere}.metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin:32px 0}.metric,.panel{border:1px solid #293241;border-radius:16px;background:#121923}.metric{padding:20px}.metric span{display:block;color:#aeb9c9;font-size:12px;text-transform:uppercase}.metric strong{display:block;margin-top:8px;font:700 28px/1 ui-monospace,monospace}.panel{margin-top:16px;overflow:hidden}.panel h2{margin:0;padding:20px 22px;border-bottom:1px solid #293241}table{width:100%;border-collapse:collapse}th,td{padding:10px 22px;border-bottom:1px solid #202937}th{color:#aeb9c9;font-size:12px;text-align:left;text-transform:uppercase}th:last-child,td:last-child{text-align:right}td:last-child{font-family:ui-monospace,monospace}ul{list-style:none;margin:0;padding:14px 22px}li{display:flex;justify-content:space-between;padding:8px 0}code{color:#cbd6e6}@media(max-width:600px){.metrics{grid-template-columns:1fr}.identity h1{font-size:28px}}
</style></head><body><main><p class="eyebrow">photoctl / library inventory</p><section class="identity"><span class="label">Library ID</span><h1>${escapeHtml(evidence.libraryId)}</h1><span class="label">Library path</span><p class="path">${escapeHtml(evidence.library)}</p></section>
<section class="metrics"><div class="metric"><span>Schema version</span><strong>${evidence.schemaVersion}</strong></div><div class="metric"><span>Indexed cache</span><strong>${formatBytes(evidence.cacheBytes)}</strong></div></section>
<section class="panel"><h2>Rows by table</h2><table><thead><tr><th scope="col">Table</th><th scope="col">Rows</th></tr></thead><tbody>${tableRows}</tbody></table></section><section class="panel"><h2>SQL backups</h2><ul>${backups}</ul></section>
</main></body></html>\n`;
}

async function inspectBackups(library: string): Promise<Array<{ name: string; bytes: number }>> {
  const directory = join(library, "backups");
  try {
    const names = (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .toSorted()
      .toReversed();
    return await Promise.all(
      names.map(async (name) => ({ name, bytes: (await stat(join(directory, name))).size })),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
