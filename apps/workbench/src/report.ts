import type { EnvelopeExample } from "./envelopes.js";

export function renderEnvelopeReport(examples: EnvelopeExample[]): string {
  const cards = examples
    .map(
      ({ title, note, exitCode, envelope }) => `
        <article class="card">
          <header>
            <div>
              <p class="eyebrow">Protocol schema ${envelope.schema}</p>
              <h2>${escapeHtml(title)}</h2>
            </div>
            <span class="exit exit-${exitCode}">Exit ${exitCode}</span>
          </header>
          <p class="note">${escapeHtml(note)}</p>
          <pre><code>${escapeHtml(JSON.stringify(envelope, null, 2))}</code></pre>
        </article>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>photoctl envelope workbench</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #0b0e14; color: #e8eaf0; }
      main { width: min(1180px, calc(100% - 40px)); margin: 0 auto; padding: 72px 0 96px; }
      .kicker { color: #8ba4ff; font: 700 12px/1.2 ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; }
      h1 { max-width: 720px; margin: 12px 0 14px; font-size: clamp(38px, 7vw, 72px); line-height: .98; letter-spacing: -.045em; }
      .intro { max-width: 720px; margin: 0 0 48px; color: #aeb5c5; font-size: 18px; line-height: 1.55; }
      .grid { display: grid; gap: 22px; }
      .card { overflow: hidden; border: 1px solid #272d3a; border-radius: 18px; background: #121720; box-shadow: 0 22px 70px #0006; }
      .card header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 24px 26px 18px; }
      .eyebrow { margin: 0 0 6px; color: #737e95; font: 600 11px/1.2 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .08em; }
      h2 { margin: 0; font-size: 22px; letter-spacing: -.02em; }
      .exit { flex: none; padding: 7px 10px; border: 1px solid #3c465c; border-radius: 999px; color: #cdd5e8; background: #1c2330; font: 700 12px/1 ui-monospace, monospace; }
      .exit-0 { border-color: #285d4c; color: #91e5c1; background: #102b24; }
      .exit-65, .exit-75 { border-color: #6b4934; color: #ffc48e; background: #302015; }
      .note { margin: 0; padding: 0 26px 22px; color: #aeb5c5; line-height: 1.5; }
      pre { margin: 0; padding: 24px 26px 28px; overflow-x: auto; border-top: 1px solid #272d3a; background: #0d1118; color: #cbd5e1; font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace; tab-size: 2; }
      @media (min-width: 960px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .card:first-child { grid-row: span 2; } }
    </style>
  </head>
  <body>
    <main>
      <p class="kicker">photoctl / agent contract</p>
      <h1>One envelope, three outcomes.</h1>
      <p class="intro">Representative protocol-v1 responses with the process exit code an agent observes. Success is zero; data errors are 65; retryable contention is 75.</p>
      <section class="grid" aria-label="Envelope examples">${cards}
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
