import { execFile } from "node:child_process";
import type { Envelope, ListData, ListRow } from "@photoctl/protocol";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

export interface SheetEvidence {
  library: string;
  filter: string | null;
  photos: Array<{ row: ListRow; preview: string; show: unknown }>;
}

export async function buildSheetReport(
  library: string,
  filter: string | null,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const list = await runPhotoctl(["list", ...filterArgs(filter)], library, cwd, env);
  if (!list.ok || !("data" in list)) throw new Error("photoctl list failed for the sheet");
  const data = list.data as ListData;
  const doctor = await runPhotoctl(["doctor"], library, cwd, env);
  if (!doctor.ok || !("data" in doctor)) throw new Error("photoctl doctor failed for the sheet");
  const cache = (doctor.data as { cache?: { root?: unknown } }).cache?.root;
  if (typeof cache !== "string") throw new Error("photoctl doctor did not report a cache root");
  const photos: SheetEvidence["photos"] = [];
  for (const row of data.rows) {
    const show = await runPhotoctl(["show", row.id], library, cwd, env);
    const preview =
      show.ok && "data" in show && typeof (show.data as { preview?: unknown }).preview === "string"
        ? (show.data as { preview: string }).preview
        : join(cache, "emb", `${row.id}.jpg`);
    photos.push({ row, preview, show });
  }
  return renderSheetReport({ library, filter, photos });
}

export function renderSheetReport(evidence: SheetEvidence): string {
  const cards = evidence.photos
    .map(({ row, preview, show }) => {
      const stars = row.rating > 0 ? "★".repeat(row.rating) : "Unrated";
      const flag = row.flag === "none" ? "Unflagged" : title(row.flag);
      const label = row.label ? title(row.label) : "No label";
      return `<article class="photo" data-online="${row.online}">
        <img src="${escapeHtml(pathToFileURL(preview).href)}" alt="Preview of ${escapeHtml(row.file)}">
        <div class="meta"><h2>${escapeHtml(row.file)}</h2><p class="id">${escapeHtml(row.id)}</p>
          <div class="badges"><span class="rating">${stars}</span><span class="flag ${row.flag}">${flag}</span><span class="label ${row.label ?? "none"}">${label}</span><span class="online"><i></i>${row.online ? "Online" : "Offline"}</span></div>
          <details><summary>Show JSON</summary><pre>${escapeHtml(JSON.stringify(show, null, 2))}</pre></details>
        </div></article>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>photoctl culling sheet</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#0b0e14;color:#eef2f8}main{width:min(1400px,calc(100% - 40px));margin:auto;padding:48px 0 72px}.eyebrow{margin:0;color:#9aa8bc;font:700 12px/1.2 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}h1{margin:10px 0 8px;font-size:clamp(34px,5vw,58px);letter-spacing:-.04em}.sub{margin:0 0 32px;color:#bbc5d3}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px}.photo{overflow:hidden;border:1px solid #2b3444;border-radius:16px;background:#131a24;box-shadow:0 16px 50px #0005}.photo img{display:block;width:100%;aspect-ratio:3/2;object-fit:contain;background:#080b10}.meta{padding:16px}h2{margin:0;font-size:18px}.id{margin:5px 0 14px;color:#9ca9bb;font:11px/1.3 ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis}.badges{display:flex;flex-wrap:wrap;gap:7px}.badges span{padding:6px 9px;border:1px solid #3a4659;border-radius:999px;background:#1b2431;color:#dce4ee;font-size:12px;font-weight:700}.rating{color:#ffd06a!important}.flag.pick{border-color:#397159;color:#8ce4b2}.flag.reject,.label.red{border-color:#814752;color:#ff9da9}.label.yellow{border-color:#7f6a34;color:#ffe087}.label.green{border-color:#397159;color:#8ce4b2}.label.blue{border-color:#3f638a;color:#9dcbff}.label.purple{border-color:#674c87;color:#d2adff}.online{display:flex;align-items:center;gap:6px}.online i{width:7px;height:7px;border-radius:50%;background:#58d68d}.photo[data-online=false] .online i{background:#758094}.photo[data-online=false] .online{color:#aab3c1}details{margin-top:14px;border-top:1px solid #293342;padding-top:12px}summary{cursor:pointer;color:#b7c5d8;font-size:12px}pre{overflow:auto;color:#b9c5d7;font:11px/1.5 ui-monospace,monospace}
</style></head><body><main><p class="eyebrow">photoctl / culling sheet</p><h1>Contact sheet</h1><p class="sub">${escapeHtml(evidence.library)} · ${evidence.photos.length} photos${evidence.filter ? ` · ${escapeHtml(evidence.filter)}` : ""}</p><section class="grid">${cards}</section></main></body></html>\n`;
}

async function runPhotoctl(
  args: string[],
  library: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Envelope> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [resolve(cwd, "apps/cli/dist/bin.js"), ...args],
    {
      cwd,
      env: { ...env, PHOTOCTL_NO_DAEMON: "1", PHOTOCTL_LIBRARY: library },
    },
  );
  return JSON.parse(stdout) as Envelope;
}

function filterArgs(filter: string | null): string[] {
  if (!filter) return [];
  return filter
    .trim()
    .split(/\s+/)
    .flatMap((term) => {
      const rating = /^rating(>=|<=|>|<|=)([0-5])$/.exec(term);
      if (rating) return ["--rating", `${rating[1] === "=" ? "" : rating[1]}${rating[2]}`];
      const field = /^(flag|label|tag|folder)=(.+)$/.exec(term);
      if (field) return [`--${field[1]}`, field[2]];
      throw new Error(`Unsupported sheet filter: ${term}`);
    });
}

function title(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
