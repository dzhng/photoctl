import { DEVELOP_OPERATORS, PACKAGE_PRESETS, developHash } from "@photoctl/render";

const labels: Record<string, string> = {
  neutral: "Neutral identity",
  people: "People",
  "high-contrast": "High contrast",
};

export function renderPresetsReport(): string {
  const cards = Object.entries(PACKAGE_PRESETS)
    .map(([name, develop]) => {
      const rows = flattened(develop)
        .map(([key, value]) => {
          const operator = DEVELOP_OPERATORS[key as keyof typeof DEVELOP_OPERATORS];
          return `<tr><th scope="row"><code>${escapeHtml(key)}</code></th><td>${escapeHtml(JSON.stringify(value))}</td><td><span class="tier tier-${operator?.tier ?? 2}">Tier ${operator?.tier ?? 2}</span></td></tr>`;
        })
        .join("");
      return `<article class="preset preset-${name}">
        <header><div><p class="eyebrow">${escapeHtml(name)}</p><h2>${escapeHtml(labels[name] ?? name)}</h2></div><p class="hash"><span>Develop hash</span><code>${developHash(develop)}</code></p></header>
        ${rows ? `<table><colgroup><col class="key-col"><col class="value-col"><col class="tier-col"></colgroup><thead><tr><th>Adjustment</th><th>Resolved value</th><th>Layer impact</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="identity">No adjustments. Decoder-neutral pixels pass through unchanged.</p>`}
      </article>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>photoctl develop presets</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#0b0e12;color:#f3f0e9}main{width:min(1040px,calc(100% - 40px));margin:auto;padding:64px 0 88px}.kicker,.eyebrow{font:700 12px/1.2 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:#91a7ff}h1{font-size:clamp(40px,7vw,68px);line-height:1;margin:10px 0 14px;letter-spacing:-.045em}.intro{max-width:700px;color:#aeb5c1;font-size:17px;line-height:1.55;margin:0 0 38px}.legend{display:flex;align-items:center;gap:10px;margin-bottom:18px}.legend::before{content:"Layer impact:";color:#aeb5c1;font-size:13px}.tier{display:inline-block;border-radius:999px;padding:5px 8px;font:700 11px/1 ui-monospace,monospace}.tier-1{background:#12382d;color:#91e5c1;border:1px solid #286451}.tier-2{background:#362719;color:#ffc48e;border:1px solid #6a4d34}.grid{display:grid;gap:18px}.preset{overflow:hidden;border:1px solid #29303a;border-radius:16px;background:#131820;box-shadow:0 18px 48px #0005}.preset header{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding:22px 24px;border-bottom:1px solid #29303a}.eyebrow{margin:0 0 5px;color:#94a0b3}h2{margin:0;font-size:23px}.hash{display:flex;align-items:center;gap:8px;margin:0;color:#aeb9ca;font-size:11px;text-transform:uppercase;letter-spacing:.08em}.hash code{color:#d5dbe6;background:#0c1016;padding:7px 9px;border-radius:7px;text-transform:none;letter-spacing:0}.identity{margin:0;padding:30px 24px;color:#aeb5c1}table{width:100%;table-layout:fixed;border-collapse:collapse;text-align:left}.key-col{width:50%}.value-col{width:25%}.tier-col{width:25%}th,td{padding:12px 24px;border-bottom:1px solid #232a34}thead th{color:#98a3b4;font:700 12px/1.2 ui-monospace,monospace;text-transform:uppercase}thead th:nth-child(2),tbody td:nth-child(2){text-align:right}tbody th{font-weight:500}tbody td{color:#c5cad3;font:13px/1.4 ui-monospace,monospace;font-variant-numeric:tabular-nums}tbody tr:last-child>*{border-bottom:0}@media(max-width:650px){.preset header{align-items:flex-start;flex-direction:column}.hash{font-size:11px}th,td{padding:11px 14px}}
</style></head><body><main><p class="kicker">photoctl / develop dictionary</p><h1>Develop presets</h1><p class="intro">The shipped presets are resolved dictionaries, not hidden recipes. Their stable hash identifies pixel state; the preset name is provenance and never changes that hash.</p><div class="legend"><span class="tier tier-1">Tier 1</span><span class="tier tier-2">Tier 2</span></div><section class="grid">${cards}</section></main></body></html>\n`;
}

function flattened(value: Record<string, unknown>, prefix = ""): Array<[string, unknown]> {
  return Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return item !== null && typeof item === "object" && !Array.isArray(item)
      ? flattened(item as Record<string, unknown>, path)
      : [[path, item]];
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
