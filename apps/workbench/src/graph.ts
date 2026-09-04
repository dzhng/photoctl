/* eslint-disable no-await-in-loop -- Each bounded page requires the preceding opaque cursor. */
import { openLibrary, resolvePhotoId } from "@photoctl/library";
import { ensurePhotoDocument, inspectGraph, type GraphNodeSummary } from "@photoctl/render";

export async function buildGraphReport(libraryPath: string, photo: string): Promise<string> {
  const library = await openLibrary(libraryPath);
  try {
    const photoId = await resolvePhotoId(library, photo);
    const orientation = await library.query<{ orientation: number }>(
      "SELECT orientation FROM photos WHERE id = $1",
      [photoId],
    );
    await ensurePhotoDocument(library, {
      photoId,
      orientation: orientation.rows[0]!.orientation,
    });
    const firstPage = await inspectGraph(library, { photoId, limit: 100 });
    const nodes = [...firstPage.nodes];
    let cursor = firstPage.nextCursor;
    while (cursor) {
      const page = await inspectGraph(library, { photoId, limit: 100, cursor });
      nodes.push(...page.nodes);
      cursor = page.nextCursor;
    }
    const ordered = orderFromRoot(nodes, firstPage.roots.output);
    const cards = ordered
      .map(
        (node, index) => `${index > 0 ? '<div class="arrow" aria-hidden="true">↓</div>' : ""}
        <article class="node ${node.kind}">
          <div class="node-head"><span class="kind">${escapeHtml(node.kind)}</span><span class="state ${node.artifactAvailable ? "ready" : "lazy"}">${node.artifactAvailable ? "artifact ready" : "not evaluated"}</span></div>
          <strong>${escapeHtml(shortHash(node.id))}</strong>
          <dl>
            <div><dt>Node</dt><dd>${escapeHtml(node.id)}</dd></div>
            <div><dt>Recipe</dt><dd>${escapeHtml(node.recipeHash)}</dd></div>
            <div><dt>Recipe version</dt><dd>${node.recipeVersion}</dd></div>
            <div><dt>Executions</dt><dd>${node.executionCount}</dd></div>
          </dl>
        </article>`,
      )
      .join("");
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>photoctl graph workbench</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #0a0d12; color: #eef2f7; }
      main { width: min(980px, calc(100% - 40px)); margin: 0 auto; padding: 56px 0 80px; }
      .kicker { margin: 0; color: #89a6ff; font: 700 12px/1.2 ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 10px 0 12px; font-size: clamp(34px, 6vw, 58px); letter-spacing: -.045em; }
      .intro { margin: 0 0 28px; color: #a8b0bf; line-height: 1.55; }
      .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; overflow: hidden; margin-bottom: 34px; border: 1px solid #29303d; border-radius: 14px; background: #29303d; }
      .fact { min-width: 0; padding: 16px 18px; background: #121720; }
      .fact span, dt { color: #7f899b; font: 700 10px/1.25 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }
      .fact strong { display: block; margin-top: 6px; overflow-wrap: anywhere; font: 600 12px/1.5 ui-monospace, monospace; }
      .flow { width: min(760px, 100%); margin: 0 auto; }
      .node { padding: 20px 22px; border: 1px solid #30394a; border-left: 4px solid #7898ff; border-radius: 14px; background: #121720; box-shadow: 0 16px 48px #0004; }
      .node.develop { border-left-color: #c38cff; } .node.output { border-left-color: #72d9a7; }
      .node-head { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
      .kind { color: #dfe7f5; font: 700 13px/1.2 ui-monospace, monospace; text-transform: uppercase; }
      .state { padding: 5px 8px; border-radius: 999px; background: #252c38; color: #aab3c4; font-size: 11px; }
      .state.ready { background: #15382c; color: #8de4bb; }
      .node > strong { font: 700 22px/1.3 ui-monospace, monospace; }
      dl { display: grid; gap: 8px; margin: 18px 0 0; }
      dl div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px; }
      dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: #b9c1cf; font: 12px/1.45 ui-monospace, monospace; }
      .arrow { height: 32px; color: #63718a; text-align: center; font-size: 24px; line-height: 32px; }
      .notice { margin: 24px auto 0; color: #f4c68c; text-align: center; }
      @media (max-width: 640px) { .facts { grid-template-columns: 1fr; } dl div { grid-template-columns: 1fr; gap: 3px; } }
    </style>
  </head>
  <body>
    <main>
      <p class="kicker">photoctl / immutable render graph</p>
      <h1>Active output lineage</h1>
      <p class="intro">The current document root and every logical operation reachable from it. Pixel execution is separate, so an edit can exist before its artifact does.</p>
      <section class="facts" aria-label="Revision facts">
        <div class="fact"><span>Photo</span><strong>${escapeHtml(photoId)}</strong></div>
        <div class="fact"><span>Revision</span><strong>${escapeHtml(firstPage.revisionId)}</strong></div>
        <div class="fact"><span>Render hash</span><strong>${escapeHtml(firstPage.renderHash ?? "none")}</strong></div>
        <div class="fact"><span>Output root</span><strong>${escapeHtml(firstPage.roots.output ?? "none")}</strong></div>
      </section>
      <section class="flow" aria-label="Source to output graph">${cards}</section>
    </main>
  </body>
</html>\n`;
  } finally {
    await library.close();
  }
}

function orderFromRoot(nodes: GraphNodeSummary[], root: string | undefined): GraphNodeSummary[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ordered: GraphNodeSummary[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return;
    for (const input of node.inputNodeIds) visit(input);
    ordered.push(node);
  };
  if (root) visit(root);
  return ordered;
}

function shortHash(value: string): string {
  const separator = value.indexOf("_");
  return separator < 0
    ? value
    : `${value.slice(0, separator + 1)}${value.slice(separator + 1, separator + 13)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
