export interface RaceEvidence {
  clients: number;
  rowsPerClient: number;
  expectedRows: number;
  successfulWrites: number;
  foundRows: number;
  failures: Record<string, number>;
  clientsObserved: Array<{ client: number; ok: number; failed: number; elapsedMs: number }>;
}

export function renderRaceReport(evidence: RaceEvidence): string {
  const persisted = evidence.foundRows === evidence.successfulWrites;
  const failureRows = Object.entries(evidence.failures)
    .map(([code, count]) => `<li><code>${escapeHtml(code)}</code><strong>${count}</strong></li>`)
    .join("");
  const timelines = evidence.clientsObserved
    .map(
      (client) =>
        `<tr><td>${client.client + 1}</td><td>${client.ok}</td><td>${client.failed}</td><td>${client.elapsedMs} ms</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>photoctl concurrency race</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #090d12; color: #eef2f7; }
      main { width: min(1040px, calc(100% - 40px)); margin: auto; padding: 64px 0 80px; }
      .kicker { color: #78a8ff; font: 700 12px/1.2 ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; }
      h1 { margin: 12px 0 14px; font-size: clamp(40px, 7vw, 72px); line-height: .98; letter-spacing: -.045em; }
      .intro { max-width: 700px; margin: 0 0 38px; color: #aab5c4; font-size: 18px; line-height: 1.55; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
      .metric, .panel { border: 1px solid #273140; border-radius: 16px; background: #111822; }
      .metric { padding: 20px; }
      .metric span { display: block; color: #8f9caf; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
      .metric strong { display: block; margin-top: 8px; font: 700 30px/1 ui-monospace, monospace; }
      .pass strong { color: ${persisted ? "#7de2b8" : "#ff9f92"}; }
      .panel { margin-top: 18px; overflow: hidden; }
      .panel header { padding: 22px 24px; border-bottom: 1px solid #273140; }
      h2 { margin: 0 0 6px; font-size: 20px; }
      p { margin: 0; }
      .refusal { color: #ffca87; }
      ul { display: grid; gap: 8px; margin: 0; padding: 20px 24px; list-style: none; }
      li { display: flex; justify-content: space-between; }
      code { color: #ccd8ea; }
      table { width: 100%; border-collapse: collapse; font: 14px/1.4 ui-monospace, monospace; }
      th, td { padding: 12px 24px; border-bottom: 1px solid #202938; text-align: right; }
      th:first-child, td:first-child { text-align: left; }
      th { color: #8f9caf; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
      @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } main { padding-top: 38px; } }
    </style>
  </head>
  <body>
    <main>
      <p class="kicker">G1 / daemon contention</p>
      <h1>${persisted ? "No accepted write was lost." : "Persistence mismatch."}</h1>
      <p class="intro">${evidence.clients} real CLI clients each attempted ${evidence.rowsPerClient} tag writes through one daemon. Capacity refusal is explicit and safe to retry.</p>
      <section class="grid" aria-label="Race summary">
        <div class="metric"><span>Attempted</span><strong>${evidence.expectedRows}</strong></div>
        <div class="metric"><span>Accepted</span><strong>${evidence.successfulWrites}</strong></div>
        <div class="metric pass"><span>Persisted</span><strong>${evidence.foundRows}</strong></div>
      </section>
      <section class="panel">
        <header><h2>${evidence.foundRows} / ${evidence.successfulWrites} accepted rows persisted</h2><p class="refusal">Library busy — retry this command.</p></header>
        <ul>${failureRows || "<li><code>none</code><strong>0</strong></li>"}</ul>
      </section>
      <section class="panel">
        <header><h2>Client timelines</h2><p>Each client reports completed and refused writes; nothing disappears silently.</p></header>
        <table><thead><tr><th>Client</th><th>OK</th><th>Failed</th><th>Elapsed</th></tr></thead><tbody>${timelines}</tbody></table>
      </section>
    </main>
  </body>
</html>\n`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
