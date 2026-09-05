import { openLibrary, resolvePhotoId } from "@photoctl/library";
import { activeLayerStatus, readActiveDevelopState } from "@photoctl/render";

export async function buildLayersReport(libraryPath: string, photo: string): Promise<string> {
  const library = await openLibrary(libraryPath);
  try {
    const photoId = await resolvePhotoId(library, photo);
    const orientation = await library.query<{ orientation: number }>(
      "SELECT orientation FROM photos WHERE id = $1",
      [photoId],
    );
    const document = await readActiveDevelopState(library, {
      photoId,
      orientation: orientation.rows[0]!.orientation,
    });
    const status = activeLayerStatus(document);
    const cards = document.layers
      .toReversed()
      .map(
        (layer) => `<article class="layer ${layer.role}">
          <div class="layer-head">
            <span class="order">${layer.z + 1}</span>
            <div><strong>${escapeHtml(layer.name)}</strong><span>${escapeHtml(layer.role)}</span></div>
            ${layer.role === "vacancy" ? '<i class="vacancy-swatch" aria-label="Magenta vacancy placeholder"></i>' : ""}
          </div>
          <dl>
            <div><dt>Layer</dt><dd>${escapeHtml(layer.id)}</dd></div>
            <div><dt>Content root</dt><dd>${escapeHtml(layer.contentNodeId)}</dd></div>
            <div><dt>Mask root</dt><dd>${escapeHtml(layer.maskNodeId)}</dd></div>
            <div><dt>State</dt><dd>${layer.enabled ? "enabled" : "disabled"}${status.staleIds.includes(layer.id) ? " · stale" : ""}</dd></div>
            ${layer.ofLayer ? `<div><dt>Vacancy for</dt><dd>${escapeHtml(layer.ofLayer)}</dd></div>` : ""}
          </dl>
        </article>`,
      )
      .join('<div class="stack-arrow" aria-hidden="true">↑</div>');
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>photoctl layers workbench</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #090c12; color: #edf2f8; }
      main { width: min(1180px, calc(100% - 40px)); margin: auto; padding: 52px 0 76px; }
      .kicker { margin: 0; color: #93a9ff; font: 700 12px/1.2 ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 10px 0 8px; font-size: clamp(36px, 6vw, 62px); letter-spacing: -.045em; }
      .intro { max-width: 720px; margin: 0 0 30px; color: #aab4c2; line-height: 1.55; }
      .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, .72fr); gap: 24px; align-items: start; }
      .panel { border: 1px solid #2b3443; border-radius: 16px; background: #111720; box-shadow: 0 20px 60px #0005; }
      .panel > h2 { margin: 0; padding: 18px 20px; border-bottom: 1px solid #2b3443; font-size: 14px; letter-spacing: .06em; text-transform: uppercase; }
      .stack { padding: 20px; }
      .layer { padding: 16px; border: 1px solid #344055; border-left: 4px solid #7899ff; border-radius: 12px; background: #171e29; }
      .layer.vacancy { border-left-color: #ff00ff; background: linear-gradient(100deg, #29142a, #171e29 42%); }
      .layer-head { display: grid; grid-template-columns: 34px 1fr auto; gap: 12px; align-items: center; }
      .order { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 50%; background: #273246; color: #cfd8e8; font: 700 12px/1 ui-monospace, monospace; }
      .layer-head strong, .layer-head span { display: block; }
      .layer-head div span { margin-top: 3px; color: #8f9aab; font: 700 10px/1.2 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }
      .vacancy-swatch { width: 28px; height: 28px; border: 2px solid #ffc5ff; border-radius: 7px; background: #ff00ff; box-shadow: 0 0 22px #ff00ff66; }
      .stack-arrow { height: 28px; color: #69768a; text-align: center; font-size: 20px; line-height: 28px; }
      dl { display: grid; gap: 7px; margin: 14px 0 0; }
      dl div { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 10px; }
      dt { color: #7f8a9b; font: 700 10px/1.4 ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase; }
      dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: #b8c1cf; font: 11px/1.45 ui-monospace, monospace; }
      .roots { display: grid; gap: 14px; padding: 20px; }
      .root { padding: 16px; border: 1px solid #344055; border-radius: 12px; background: #171e29; }
      .root span { display: block; margin-bottom: 7px; color: #8f9aab; font: 700 10px/1.2 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }
      .root strong { display: block; overflow-wrap: anywhere; font: 600 11px/1.5 ui-monospace, monospace; }
      .facts { margin-top: 8px; color: #aab4c2; font-size: 12px; }
      @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } dl div { grid-template-columns: 1fr; gap: 2px; } }
    </style>
  </head>
  <body>
    <main>
      <p class="kicker">photoctl / immutable layer projection</p>
      <h1>Layers beside their DAG roots</h1>
      <p class="intro">The active revision orders stable layer identities while each row points to immutable content and mask roots. Magenta marks an original silhouette whose generated fill is still pending.</p>
      <section class="layout">
        <div class="panel"><h2>Front-to-back stack</h2><div class="stack">${cards || '<p class="facts">No active layers.</p>'}</div></div>
        <aside class="panel"><h2>Active document</h2><div class="roots">
          <div class="root"><span>Photo</span><strong>${escapeHtml(photoId)}</strong></div>
          <div class="root"><span>Revision</span><strong>${escapeHtml(document.revisionId)}</strong></div>
          <div class="root"><span>Base root</span><strong>${escapeHtml(document.baseNodeId)}</strong></div>
          <div class="root"><span>Output root</span><strong>${escapeHtml(document.outputNodeId)}</strong></div>
          <div class="root"><span>Render hash</span><strong>${escapeHtml(document.renderHash)}</strong></div>
          <p class="facts">${status.count} active layer${status.count === 1 ? "" : "s"} · ${status.staleIds.length} stale · ${status.unfilledVacancyIds.length} unfilled ${status.unfilledVacancyIds.length === 1 ? "vacancy" : "vacancies"}</p>
        </div></aside>
      </section>
    </main>
  </body>
</html>\n`;
  } finally {
    await library.close();
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
