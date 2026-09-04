import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import sharp from "sharp";

export async function buildAbReport(
  neutralPath: string,
  editedPath: string,
  variable: string,
): Promise<string> {
  const [neutral, edited] = await Promise.all([
    inspectImage(neutralPath),
    inspectImage(editedPath),
  ]);
  if (neutral.w !== edited.w || neutral.h !== edited.h) {
    throw new Error("wb ab inputs must have identical dimensions");
  }
  const cards = [
    { label: "Neutral", path: neutralPath, image: neutral },
    { label: "Edited", path: editedPath, image: edited },
  ]
    .map(
      ({ label, path, image }) =>
        `<article><h2>${label}</h2><img src="data:image/png;base64,${image.png.toString("base64")}" alt="${label} ${escapeHtml(variable)}"><dl><dt>File</dt><dd>${escapeHtml(basename(path))}</dd><dt>Dimensions</dt><dd>${image.w} × ${image.h}</dd><dt>SHA-256</dt><dd><code>${image.hash}</code></dd></dl></article>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>photoctl A/B · ${escapeHtml(variable)}</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#0b0e12;color:#f3f0e9}main{width:min(1400px,calc(100% - 40px));margin:auto;padding:48px 0 72px}.eyebrow{font:700 12px/1.2 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#91a7ff}h1{font-size:clamp(36px,6vw,62px);margin:8px 0 12px;letter-spacing:-.04em}.target{color:#bac3d1;margin:0 0 30px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}article{overflow:hidden;border:1px solid #29303a;border-radius:16px;background:#131820}h2{margin:0;padding:16px 20px}img{display:block;width:100%;height:auto;background:#07090c}dl{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;padding:16px 20px;margin:0;border-top:1px solid #29303a;font-size:12px}dt{color:#8f9bac}dd{margin:0;overflow-wrap:anywhere}code{font:11px/1.4 ui-monospace,monospace}@media(max-width:760px){.grid{grid-template-columns:1fr}}
</style></head><body><main><p class="eyebrow">photoctl / develop A/B</p><h1>${escapeHtml(title(variable))}</h1><p class="target">Judged variable: ${escapeHtml(variable)}. Only equal pixel dimensions are verified; confirm source, framing, and encoding from capture provenance.</p><section class="grid">${cards}</section></main></body></html>\n`;
}

async function inspectImage(path: string) {
  const source = await readFile(path);
  const rendered = await sharp(source).png().toBuffer({ resolveWithObject: true });
  return {
    png: rendered.data,
    w: rendered.info.width,
    h: rendered.info.height,
    hash: createHash("sha256").update(rendered.data).digest("hex"),
  };
}

function title(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
