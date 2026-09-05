/* eslint-disable no-await-in-loop -- Inspect one full-resolution mask at a time. */
import { openLibrary, resolvePhotoId } from "@photoctl/library";
import {
  activeLayerStatus,
  artifactPath,
  evaluateGraphNode,
  loadActiveDocument,
  loadBaseProjection,
  projectMaskToRender,
  readActiveDevelopState,
  readArtifactImage,
  readArtifactMask,
  type Image16,
  type MaskImage,
} from "@photoctl/render";
import sharp from "sharp";

export async function buildMasksReport(libraryPath: string, photo: string): Promise<string> {
  const library = await openLibrary(libraryPath);
  try {
    const photoId = await resolvePhotoId(library, photo);
    const document = await loadActiveDocument(library, photoId);
    if (!document || !document.layers.length)
      throw new Error("Photo has no committed masks to inspect");
    const row = (
      await library.query<{
        execution_id: string;
        output_artifact_hash: `a_${string}`;
        w: number;
        h: number;
        created_at: string;
      }>(
        `SELECT execution.execution_id, execution.output_artifact_hash, artifact.w, artifact.h, execution.created_at::text
       FROM node_executions execution JOIN image_artifacts artifact ON artifact.artifact_hash = execution.output_artifact_hash
       WHERE execution.photo_id = $1 AND execution.node_id = $2 AND artifact.artifact_available = true
       ORDER BY artifact.w::bigint * artifact.h DESC, execution.created_at DESC, execution.execution_id LIMIT 1`,
        [photoId, document.roots.base],
      )
    ).rows[0];
    if (!row)
      throw new Error(
        "Run photoctl show first: the current develop root has no cached RGB context",
      );
    const image = await readArtifactImage(
      artifactPath(libraryPath, row.output_artifact_hash, "tif"),
      row.output_artifact_hash,
    );
    const projection = await loadBaseProjection(library, photoId, {
      executionId: row.execution_id,
      artifact: { artifactHash: row.output_artifact_hash, w: row.w, h: row.h },
    });
    const orientation = (
      await library.query<{ orientation: number }>("SELECT orientation FROM photos WHERE id=$1", [
        photoId,
      ])
    ).rows[0]!.orientation;
    const status = await activeLayerStatus(
      library,
      await readActiveDevelopState(library, { photoId, orientation }),
    );
    const cards: string[] = [];
    for (const layer of document.layers) {
      const evaluated = await evaluateGraphNode({
        database: library,
        libraryPath,
        photoId,
        nodeId: layer.maskNodeId,
      });
      const stored = await readArtifactMask(
        evaluated.artifact.path,
        evaluated.artifact.artifactHash,
      );
      const mask = await projectMaskToRender(stored, projection, image);
      const edge = mask.data.findIndex((value) => value > 0);
      if (edge < 0) {
        cards.push(
          `<section><h2>${escapeHtml(layer.name)}</h2><p>No covered pixels in the current develop crop.</p><code>${evaluated.artifact.artifactHash}</code></section>`,
        );
        continue;
      }
      const crop = { w: Math.min(256, image.w), h: Math.min(256, image.h), x: 0, y: 0 };
      crop.x = Math.max(0, Math.min(image.w - crop.w, (edge % image.w) - Math.floor(crop.w / 2)));
      crop.y = Math.max(
        0,
        Math.min(image.h - crop.h, Math.floor(edge / image.w) - Math.floor(crop.h / 2)),
      );
      const panels = await maskPanels(image, mask, crop);
      cards.push(`<section><h2>${escapeHtml(layer.name)}</h2><p>${layer.enabled ? "Enabled" : "Disabled"}${status.staleIds.includes(layer.id) ? " · Stale layer: current develop differs from its creation context" : ""} · Crop origin ${crop.x}, ${crop.y} · ${crop.w} × ${crop.h} rendered px</p><p>Overlay: 3-pixel cyan contour with a dark halo. Coverage panel is unchanged.</p>
        <details><summary>Immutable mask identity</summary><code>${escapeHtml(layer.id)}<br>${escapeHtml(layer.maskNodeId)}<br>${evaluated.artifact.artifactHash}</code></details>
        <div class="panels">${panels.map((bytes, index) => `<figure><figcaption>${["Cached current develop", "Committed mask coverage", "Develop + mask edge"][index]}</figcaption><div class="image"><img width="${crop.w}" height="${crop.h}" alt="${["Develop context", "Mask coverage", "Cyan mask edge"][index]}" src="data:image/png;base64,${bytes.toString("base64")}"></div></figure>`).join("")}</div></section>`);
    }
    const facts = [
      ["Photo", photoId],
      ["Revision", document.revisionId],
      ["Base root", document.roots.base],
      ["RGB artifact", row.output_artifact_hash],
      ["Execution", row.execution_id],
      ["Cached", row.created_at],
      [
        "Density tier",
        projection.source.w < projection.catalog.w || projection.source.h < projection.catalog.h
          ? "Reduced cached source"
          : "Full-resolution cached source",
      ],
      ["Rendered context", `${image.w} × ${image.h} px`],
      [
        "Source / catalog",
        `${projection.source.w} × ${projection.source.h} / ${projection.catalog.w} × ${projection.catalog.h} px`,
      ],
    ]
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value!)}</dd></div>`)
      .join("");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>photoctl masks workbench</title><style>
      :root{color-scheme:dark;font-family:system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#090c12;color:#edf2f8}main{width:min(1200px,calc(100% - 40px));margin:40px auto}h1{font-size:42px;letter-spacing:-.04em}p{color:#aab4c2;line-height:1.6}code{overflow-wrap:anywhere;font-size:11px}section{margin:28px 0;padding:22px;border:1px solid #2b3443;border-radius:16px;background:#111720}h2{margin:0}.panels{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}figure{margin:18px 0 0;min-width:0}figcaption{font-size:13px;margin-bottom:12px}.image{overflow:auto;background:#05070a;padding:12px;min-height:280px;display:grid;place-items:center}img{display:block;max-width:none}summary{cursor:pointer;color:#70d9d1}.identity{padding:16px;background:#111720;border-radius:12px}@media(max-width:900px){.panels{grid-template-columns:1fr}}
      .identity dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:0}.identity dt{font-size:12px;color:#aab4c2;margin-bottom:6px}.identity dd{font:13px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;margin:0;padding-left:8px;border-left:2px solid #344055}@media(max-width:900px){.identity dl{grid-template-columns:1fr}}
      </style></head><body><main><p>photoctl / mask inspection</p><h1>Native-detail mask edges</h1><p>Each row shares one crop at one rendered pixel per displayed pixel, anchored to the first covered sample in scan order and clamped at image bounds. RGB uses the highest-resolution available cached execution of the current develop root, newest-created on equal area—not necessarily the last shown source tier, and not the historical SAM input. These images do not certify SAM quality or identify hair/foliage automatically.</p><div class="identity"><dl>${facts}</dl></div>${cards.join("")}</main></body></html>\n`;
  } finally {
    await library.close();
  }
}

async function maskPanels(
  image: Image16,
  mask: MaskImage,
  crop: { x: number; y: number; w: number; h: number },
) {
  const edges = new Uint8Array(crop.w * crop.h);
  const rgb = Buffer.alloc(crop.w * crop.h * 3),
    coverage = Buffer.alloc(rgb.length),
    overlay = Buffer.alloc(rgb.length);
  for (let y = 0; y < crop.h; y++)
    for (let x = 0; x < crop.w; x++) {
      const index = (crop.y + y) * image.w + crop.x + x,
        target = (y * crop.w + x) * 3;
      const value = mask.data[index]!;
      const edge =
        value > 0 &&
        (index % image.w === 0 ||
          index % image.w === image.w - 1 ||
          index < image.w ||
          index >= image.w * (image.h - 1) ||
          [index - 1, index + 1, index - image.w, index + image.w].some(
            (neighbor) => mask.data[neighbor]! <= 0,
          ));
      edges[y * crop.w + x] = Number(edge);
      for (let channel = 0; channel < 3; channel++) {
        rgb[target + channel] = Math.round(image.data[index * 3 + channel]! / 257);
        coverage[target + channel] = Math.round(value * 255);
        overlay[target + channel] = rgb[target + channel]!;
      }
    }
  // Only the overlay is widened; the separate coverage image remains exact.
  for (let y = 0; y < crop.h; y++)
    for (let x = 0; x < crop.w; x++) {
      const index = y * crop.w + x;
      let distance = 3;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const px = x + dx,
            py = y + dy;
          if (px >= 0 && px < crop.w && py >= 0 && py < crop.h && edges[py * crop.w + px])
            distance = Math.min(distance, Math.abs(dx) + Math.abs(dy));
        }
      if (distance <= 2) overlay.set(distance <= 1 ? [41, 229, 214] : [0, 0, 0], index * 3);
    }
  return await Promise.all(
    [rgb, coverage, overlay].map(
      async (pixels) =>
        await sharp(pixels, { raw: { width: crop.w, height: crop.h, channels: 3 } })
          .png()
          .toBuffer(),
    ),
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
