import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";

interface DeliveryEvidence {
  name: string;
  bytes: number;
  width: number;
  height: number;
  format: string;
  preview: string;
}

export async function buildExportReport(directory: string): Promise<string> {
  const names = (await readdir(directory))
    .filter((name) => /\.(?:jpe?g|png|tiff?)$/iu.test(name))
    .toSorted();
  const deliveries = await Promise.all(
    names.map(async (name) => await inspectDelivery(join(directory, name))),
  );
  const cards = deliveries
    .map(
      (item) => `
      <article>
        <img src="${item.preview}" alt="${escapeHtml(item.name)}">
        <div><h2>${escapeHtml(item.name)}</h2><p>${item.width} × ${item.height} · ${escapeHtml(item.format.toUpperCase())} · ${formatBytes(item.bytes)}</p></div>
      </article>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>photoctl delivery review</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#101113;color:#f4f1e8}main{width:min(1180px,calc(100% - 40px));margin:auto;padding:48px 0 80px}.kicker{color:#dfb76c;font:700 12px/1.2 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}h1{margin:10px 0 12px;font-size:clamp(38px,6vw,68px);letter-spacing:-.045em}.intro{margin:0 0 30px;color:#c1bdb3;font-size:18px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}article{overflow:hidden;border:1px solid #34332f;border-radius:16px;background:#1a1b1e;box-shadow:0 20px 60px #0006}img{display:block;width:100%;aspect-ratio:3/2;object-fit:contain;background:#090a0b}article div{padding:16px 18px 19px}h2{overflow:hidden;margin:0 0 6px;font-size:16px;text-overflow:ellipsis;white-space:nowrap}p{margin:0;color:#c1bdb3;font:13px/1.5 ui-monospace,monospace}.empty{padding:40px;border:1px dashed #45433d;border-radius:16px;color:#aaa69c}
</style></head><body><main><p class="kicker">photoctl / delivered folder</p><h1>Export contact sheet</h1><p class="intro">${deliveries.length} delivery ${deliveries.length === 1 ? "file" : "files"} in ${escapeHtml(basename(directory))}</p>${deliveries.length > 0 ? `<section class="grid">${cards}</section>` : '<p class="empty">No delivery images found.</p>'}</main></body></html>\n`;
}

async function inspectDelivery(path: string): Promise<DeliveryEvidence> {
  const [file, metadata, preview] = await Promise.all([
    stat(path),
    sharp(path).metadata(),
    sharp(path)
      .rotate()
      .resize({ width: 720, height: 480, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer(),
  ]);
  if (!metadata.width || !metadata.height || !metadata.format)
    throw new Error(`Unreadable delivery image: ${path}`);
  return {
    name: basename(path),
    bytes: file.size,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    preview: `data:image/jpeg;base64,${preview.toString("base64")}`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}
