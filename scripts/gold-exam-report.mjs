import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const [scratch, outputArgument, source, sourceKind = "unverified"] = process.argv.slice(2);
if (
  !scratch ||
  !outputArgument ||
  !source ||
  !["fixture", "real", "unverified"].includes(sourceKind)
)
  throw new Error("Expected scratch, output, source and fixture|real|unverified source kind");
const output = resolve(outputArgument);
const read = async (name) => JSON.parse(await readFile(join(scratch, `${name}.json`), "utf8"));
const report = {
  schema: 1,
  source: resolve(source),
  source_kind: sourceKind,
  photographic_acceptance: "not_recorded",
  generated_at: new Date().toISOString(),
  output,
  import: await read("import"),
  list: await read("list"),
  rate: await read("rate"),
  develop: await read("develop"),
  export: await read("export"),
};
// The export result owns membership; unrelated files in a reused folder are not exam evidence.
report.deliveries = await Promise.all(
  report.export.results
    .filter((item) => item.ok)
    .map(async (item) => {
      const file = relative(output, resolve(item.file));
      if (isAbsolute(file) || file === ".." || file.startsWith(`..${sep}`))
        throw new Error(`Delivery outside report folder: ${item.file}`);
      return { ...item, file, ...(await hashFile(join(output, file))) };
    }),
);
await writeFile(join(output, "gold-exam-report.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(output, "report.html"), renderReport(report));
const files = [
  ...report.deliveries,
  ...(await Promise.all(
    ["gold-exam-report.json", "report.html"].map(async (file) => ({
      file,
      ...(await hashFile(join(output, file))),
    })),
  )),
];
const sums = files.map(({ file, sha256 }) => {
  const escaped = file.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
  return `${escaped === file ? "" : "\\"}${sha256}  ${escaped}\n`;
});
await writeFile(join(output, "SHA256SUMS"), sums.join(""));

async function hashFile(file) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderReport(value) {
  const sourceLabel = {
    fixture: "Fixture evidence",
    real: "Operator-declared real input",
    unverified: "Source kind unverified",
  }[value.source_kind];
  const cards = value.deliveries
    .map((item, index) => {
      const url = item.file.split(sep).map(encodeURIComponent).join("/");
      return `<article>
<a class="image" href="${url}"><img src="${url}" alt="Delivery ${index + 1}: ${escapeHtml(item.file)}" loading="lazy"></a>
<div class="caption"><p class="number">Delivery ${String(index + 1).padStart(2, "0")}</p>
<h2><a href="${url}">${escapeHtml(item.file)}</a></h2>
<p>${item.skipped ? "Requested: " : ""}${item.w} × ${item.h} · ${item.bytes.toLocaleString("en-US")} bytes</p>
${item.skipped ? '<p class="notice">Skipped export: pre-existing file; current-render match not verified.</p>' : ""}
<details><summary>Identity &amp; checksum</summary><dl>
<dt>Photo</dt><dd>${escapeHtml(item.id)}</dd>
<dt>Render identity${item.skipped ? " (requested)" : ""}</dt><dd>${escapeHtml(item.render_hash)}</dd>
<dt>Delivered file SHA256</dt><dd>${item.sha256}</dd>
</dl></details></div></article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>photoctl gold exam — ${sourceLabel}</title>
<style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,sans-serif;background:#111416;color:#f3f0e8}*{box-sizing:border-box}
body{margin:0}main{max-width:1200px;margin:auto;padding:48px 24px 72px}a{color:inherit;text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:3px solid #e6be79;outline-offset:4px}
.eyebrow,.number{font:600 12px/1.5 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#e6be79}h1{font-size:clamp(36px,6vw,64px);letter-spacing:-.04em;line-height:1.1;margin:12px 0 16px}
.intro{font-size:18px;color:#c3c8cb;max-width:760px;line-height:1.5}.notice{border-left:3px solid #e6be79;padding:12px 16px;background:#24231e;line-height:1.5}.metadata{color:#c3c8cb;font-size:14px;line-height:1.7;overflow-wrap:anywhere}
nav{display:flex;flex-wrap:wrap;gap:12px 24px;margin:24px 0 32px}nav a{font-size:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:24px}
article{min-width:0;background:#1b2023;border:1px solid #384047;border-radius:12px;overflow:hidden}.image{display:block;background:#090b0c}.image img{display:block;width:100%;aspect-ratio:3/2;object-fit:contain}
.caption{padding:20px}.number{margin:0 0 6px}h2{font-size:17px;margin:0 0 10px;overflow-wrap:anywhere}.caption>p:not(.number){font-size:14px;color:#c3c8cb}details{margin-top:20px;font-size:14px}summary{cursor:pointer;color:#dbe0e2}dt{margin-top:16px;padding-top:12px;border-top:1px solid #384047;color:#c3c8cb}dd{margin:4px 0 0;font:13px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}
footer{margin-top:36px;font-size:14px;color:#c3c8cb;line-height:1.6}@media(max-width:480px){main{padding:28px 16px 48px}.caption{padding:16px}nav{flex-direction:column;align-items:flex-start}}
</style></head><body><main>
<p class="eyebrow">photoctl / gold exam / ${sourceLabel}</p><h1>Delivery evidence</h1>
<p class="intro">${value.deliveries.length} delivery files. Inspect the actual JPEGs below; open any image at its delivered resolution.</p>
<p class="notice"><strong>Photographic acceptance not recorded.</strong> ${value.source_kind === "fixture" ? "This run uses test fixtures, not a real-drive photographic exam." : "Source classification is operator-supplied, not independently verified."} A successful command or matching checksum is not a quality verdict.</p>
<p class="metadata">Source: ${escapeHtml(value.source)}<br>Recorded: ${escapeHtml(value.generated_at)}</p>
<nav aria-label="Evidence files"><a href="gold-exam-report.json">Command results (JSON)</a><a href="SHA256SUMS">SHA256 manifest</a><a href="report.html">Report permalink</a></nav>
<section class="grid" aria-label="Delivered JPEGs">${cards}</section>
<footer>Checksums cover the delivered bytes, command report and this HTML file. Keep the folder together to preserve its relative links. Verify with <code>shasum -a 256 -c SHA256SUMS</code> from this folder.</footer>
</main></body></html>\n`;
}
