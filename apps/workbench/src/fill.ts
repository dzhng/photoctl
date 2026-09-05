import { openLibrary, resolvePhotoId } from "@photoctl/library";
import {
  describeFillBranch,
  evaluateGraphNode,
  artifactPath,
  loadActiveDocument,
  readArtifactLinear,
  readArtifactImage,
  readArtifactMask,
  resolveLayerId,
  type Image16,
  type MaskImage,
  type SourceExecutionProvenance,
} from "@photoctl/render";
import sharp from "sharp";

interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function buildFillReport(
  libraryPath: string,
  photo: string,
  layer: string,
): Promise<string> {
  const library = await openLibrary(libraryPath);
  try {
    const photoId = await resolvePhotoId(library, photo);
    const document = await loadActiveDocument(library, photoId);
    if (!document) throw new Error(`Photo has no active document: ${photoId}`);
    const layerId = await resolveLayerId(library, photoId, layer);
    const selected = document.layers.find(({ id }) => id === layerId);
    if (!selected) throw new Error(`Layer is not present in the active revision: ${layerId}`);
    const branch = await describeFillBranch(library, photoId, selected.contentNodeId);
    if (!branch) throw new Error("Layer does not contain a refreshable fill branch");
    if (selected.maskNodeId !== branch.maskNodeId) {
      throw new Error("Fill report does not yet support transformed fill layers");
    }
    const source = await cachedSourceProducer(
      library,
      libraryPath,
      photoId,
      branch.generation.id,
      branch.generationExecution.executionId,
    );

    // Evaluating the active branch can materialize deterministic nodes, but paid nodes only
    // resolve their immutable pinned artifacts and therefore cannot invoke a provider here.
    const current = await evaluateGraphNode({
      database: library,
      libraryPath,
      photoId,
      nodeId: branch.contentRootId,
      source,
    });
    const before = await evaluateGraphNode({
      database: library,
      libraryPath,
      photoId,
      nodeId: branch.baseNodeId,
      source,
    });
    const generated = await evaluateGraphNode({
      database: library,
      libraryPath,
      photoId,
      nodeId: branch.resample.id,
      source,
    });
    const mask = await evaluateGraphNode({
      database: library,
      libraryPath,
      photoId,
      nodeId: branch.maskNodeId,
      source,
    });
    const [beforeImage, generatedImage, currentImage, maskImage] = await Promise.all([
      readArtifactImage(before.artifact.path, before.artifact.artifactHash),
      readArtifactImage(generated.artifact.path, generated.artifact.artifactHash),
      readArtifactImage(current.artifact.path, current.artifact.artifactHash),
      readArtifactMask(mask.artifact.path, mask.artifact.artifactHash),
    ]);
    assertComparable(beforeImage, generatedImage, currentImage, maskImage, branch.crop);

    const [beforePng, generatedPng, currentPng, boundaryPng] = await Promise.all([
      cropPng(beforeImage, branch.crop),
      cropPng(generatedImage, branch.crop),
      cropPng(currentImage, branch.crop),
      boundaryPngFor(currentImage, maskImage, branch.crop),
    ]);
    const generationParameters = asRecord(branch.generation.parameters);
    const prompt =
      typeof generationParameters?.prompt === "string" ? generationParameters.prompt : "";
    const cropLabel = `${branch.crop.x}, ${branch.crop.y} · ${branch.crop.w} × ${branch.crop.h} base px`;
    const upscaleFacts = branch.upscaleProvider
      ? `<div class="fact"><span>Upscale</span><strong>${escapeHtml(branch.upscaleProvider.adapter)} · ${escapeHtml(branch.upscaleProvider.model)}</strong></div>
        <div class="fact"><span>Upscale node</span><strong>${escapeHtml(branch.upscale!.id)}</strong></div>`
      : "";
    const cards = [
      {
        title: "Before fill",
        note: "The immutable base input beneath the strict composite.",
        bytes: beforePng,
      },
      {
        title: "After fill · generated replacement",
        note: "The accepted generated pixels after their one exact placement resample, before the strict mask composite.",
        bytes: generatedPng,
      },
      {
        title: "Current layer result",
        note: "The active layer content at this revision, including deterministic descendants.",
        bytes: currentPng,
      },
      {
        title: "Current + mask boundary",
        note: "The same current pixels with the canonical mask edge marked in cyan.",
        bytes: boundaryPng,
      },
    ]
      .map(
        ({ title, note, bytes }) => `<article class="frame">
          <header><h2>${escapeHtml(title)}</h2><span>${escapeHtml(cropLabel)}</span></header>
          <div class="image"><img alt="${escapeHtml(title)} at the shared native crop" src="data:image/png;base64,${bytes.toString("base64")}" width="${branch.crop.w}" height="${branch.crop.h}"></div>
          <p>${escapeHtml(note)}</p>
        </article>`,
      )
      .join("");
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>photoctl fill workbench</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #090c12; color: #edf2f8; }
      main { width: min(1440px, calc(100% - 40px)); margin: auto; padding: 52px 0 76px; }
      .kicker { margin: 0; color: #70d9d1; font: 700 12px/1.2 ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 10px 0 8px; font-size: clamp(36px, 6vw, 62px); letter-spacing: -.045em; }
      .intro { max-width: 800px; margin: 0 0 28px; color: #aab4c2; line-height: 1.55; }
      .facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; overflow: hidden; margin-bottom: 28px; border: 1px solid #2b3443; border-radius: 14px; background: #2b3443; }
      .fact { min-width: 0; padding: 14px 16px; background: #111720; }
      .fact span { display: block; color: #7f8a9b; font: 700 10px/1.3 ui-monospace, monospace; letter-spacing: .07em; text-transform: uppercase; }
      .fact strong { display: block; margin-top: 5px; overflow-wrap: anywhere; color: #c5cedb; font: 600 11px/1.45 ui-monospace, monospace; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
      .frame { overflow: hidden; border: 1px solid #2b3443; border-radius: 16px; background: #111720; box-shadow: 0 20px 60px #0005; }
      .frame header { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; padding: 16px 18px; border-bottom: 1px solid #2b3443; }
      h2 { margin: 0; font-size: 15px; }
      .frame header span { color: #8995a7; font: 10px/1.4 ui-monospace, monospace; }
      .image { display: grid; min-height: 220px; padding: 18px; place-items: center; background: #05070a; }
      img { display: block; max-width: 100%; height: auto; image-rendering: auto; }
      .frame p { margin: 0; padding: 14px 18px 17px; color: #9faaba; font-size: 12px; line-height: 1.5; }
      @media (max-width: 800px) { .facts, .grid { grid-template-columns: 1fr; } .frame header { display: block; } .frame header span { display: block; margin-top: 6px; } }
    </style>
  </head>
  <body>
    <main>
      <p class="kicker">photoctl / immutable fill inspection</p>
      <h1>Native-detail fill boundary</h1>
      <p class="intro">Every panel is the same base-space crop at one source pixel per output pixel. Compare texture and sharpness at the marked mask edge; this report reads the active graph and its pinned paid artifacts without sending pixels to a provider.</p>
      <section class="facts" aria-label="Fill provenance">
        <div class="fact"><span>Photo · layer</span><strong>${escapeHtml(photoId)} · ${escapeHtml(layerId)}</strong></div>
        <div class="fact"><span>Revision · render</span><strong>${escapeHtml(document.revisionId)} · ${escapeHtml(document.renderHash)}</strong></div>
        <div class="fact"><span>Generation</span><strong>${escapeHtml(branch.generationProvider.adapter)} · ${escapeHtml(branch.generationProvider.model)}</strong></div>
        <div class="fact"><span>Prompt</span><strong>${escapeHtml(prompt)}</strong></div>
        <div class="fact"><span>Generate node</span><strong>${escapeHtml(branch.generation.id)}</strong></div>
        <div class="fact"><span>Composite node</span><strong>${escapeHtml(branch.composite.id)}</strong></div>
        ${upscaleFacts}
      </section>
      <section class="grid" aria-label="Shared native-detail comparison">${cards}</section>
    </main>
  </body>
</html>\n`;
  } finally {
    await library.close();
  }
}

async function cachedSourceProducer(
  database: {
    query<Row>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
  },
  libraryPath: string,
  photoId: string,
  generationNodeId: string,
  generationExecutionId: string,
) {
  const result = await database.query<{
    output_artifact_hash: string;
    source_locator: unknown;
    source_tier: "online-file" | "online-jpeg-range" | "pinned-preview";
    source_w: number;
    source_h: number;
    decoder_id: string;
    decoder_version: string;
  }>(
    `WITH RECURSIVE lineage(node_id, execution_id) AS (
       SELECT edge.input_node_id, input_execution.execution_id
       FROM image_node_inputs AS edge
       JOIN node_execution_inputs AS input
         ON input.photo_id = edge.photo_id AND input.execution_id = $3 AND input.input_index = 0
       JOIN node_executions AS input_execution
         ON input_execution.photo_id = edge.photo_id
        AND input_execution.node_id = edge.input_node_id
        AND input_execution.output_artifact_hash = input.input_artifact_hash
       WHERE edge.photo_id = $1 AND edge.node_id = $2 AND edge.input_index = 0
       UNION ALL
       SELECT edge.input_node_id, input_execution.execution_id
       FROM lineage
       JOIN image_node_inputs AS edge
         ON edge.photo_id = $1 AND edge.node_id = lineage.node_id AND edge.input_index = 0
       JOIN node_execution_inputs AS input
         ON input.photo_id = edge.photo_id
        AND input.execution_id = lineage.execution_id
        AND input.input_index = 0
       JOIN node_executions AS input_execution
         ON input_execution.photo_id = edge.photo_id
        AND input_execution.node_id = edge.input_node_id
        AND input_execution.output_artifact_hash = input.input_artifact_hash
     )
     SELECT execution.output_artifact_hash, execution.source_locator, execution.source_tier,
       execution.source_w, execution.source_h, execution.decoder_id, execution.decoder_version
     FROM lineage
     JOIN image_nodes AS node ON node.photo_id = $1 AND node.id = lineage.node_id
     JOIN node_executions AS execution
       ON execution.photo_id = $1 AND execution.node_id = node.id
      AND execution.execution_id = lineage.execution_id
     JOIN image_artifacts AS artifact
       ON artifact.artifact_hash = execution.output_artifact_hash
     WHERE node.kind = 'source' AND artifact.artifact_available = true
       AND execution.source_locator IS NOT NULL
     LIMIT 1`,
    [photoId, generationNodeId, generationExecutionId],
  );
  const row = result.rows[0];
  const locator = sourceLocator(row?.source_locator);
  if (
    !row ||
    !/^a_[0-9a-f]{64}$/.test(row.output_artifact_hash) ||
    !locator ||
    row.source_tier !== locator.kind ||
    !Number.isSafeInteger(row.source_w) ||
    !Number.isSafeInteger(row.source_h) ||
    typeof row.decoder_id !== "string" ||
    typeof row.decoder_version !== "string"
  ) {
    throw new Error("Fill report requires the cached source artifact used by the fill branch");
  }
  const image = await readArtifactLinear(
    artifactPath(libraryPath, row.output_artifact_hash, "tif"),
    row.output_artifact_hash,
  );
  return async () => ({
    image,
    provenance: {
      locator,
      tier: row.source_tier,
      w: row.source_w,
      h: row.source_h,
      decoderId: row.decoder_id,
      decoderVersion: row.decoder_version,
    },
  });
}

function sourceLocator(value: unknown): SourceExecutionProvenance["locator"] | undefined {
  const locator = asRecord(value);
  if (!locator || typeof locator.kind !== "string") return undefined;
  if (locator.kind === "pinned-preview") {
    return typeof locator.cache_path === "string"
      ? { kind: "pinned-preview", cache_path: locator.cache_path }
      : undefined;
  }
  if (locator.kind !== "online-file" && locator.kind !== "online-jpeg-range") return undefined;
  if (typeof locator.volume_uuid !== "string" || typeof locator.rel_path !== "string") {
    return undefined;
  }
  if (locator.kind === "online-file") {
    return { kind: "online-file", volume_uuid: locator.volume_uuid, rel_path: locator.rel_path };
  }
  return Number.isSafeInteger(locator.offset) && Number.isSafeInteger(locator.length)
    ? {
        kind: "online-jpeg-range",
        volume_uuid: locator.volume_uuid,
        rel_path: locator.rel_path,
        offset: Number(locator.offset),
        length: Number(locator.length),
      }
    : undefined;
}

function assertComparable(
  before: Image16,
  generated: Image16,
  current: Image16,
  mask: MaskImage,
  crop: Crop,
): void {
  if (
    before.w !== generated.w ||
    before.h !== generated.h ||
    before.w !== current.w ||
    before.h !== current.h ||
    before.w !== mask.w ||
    before.h !== mask.h ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.x + crop.w > before.w ||
    crop.y + crop.h > before.h
  ) {
    throw new Error("Fill branch artifacts do not share one valid base-space crop");
  }
}

async function cropPng(image: Image16, crop: Crop): Promise<Buffer> {
  return await sharp(cropRgb8(image, crop), {
    raw: { width: crop.w, height: crop.h, channels: 3 },
  })
    .png()
    .toBuffer();
}

async function boundaryPngFor(image: Image16, mask: MaskImage, crop: Crop): Promise<Buffer> {
  const pixels = cropRgb8(image, crop);
  for (let y = 0; y < crop.h; y += 1) {
    for (let x = 0; x < crop.w; x += 1) {
      const baseX = crop.x + x;
      const baseY = crop.y + y;
      if (!isMaskBoundary(mask, baseX, baseY)) continue;
      const target = (y * crop.w + x) * 3;
      pixels[target] = 41;
      pixels[target + 1] = 229;
      pixels[target + 2] = 214;
    }
  }
  return await sharp(pixels, { raw: { width: crop.w, height: crop.h, channels: 3 } })
    .png()
    .toBuffer();
}

function cropRgb8(image: Image16, crop: Crop): Buffer {
  const output = Buffer.alloc(crop.w * crop.h * 3);
  for (let y = 0; y < crop.h; y += 1) {
    for (let x = 0; x < crop.w; x += 1) {
      const source = ((crop.y + y) * image.w + crop.x + x) * 3;
      const target = (y * crop.w + x) * 3;
      output[target] = Math.round(image.data[source]! / 257);
      output[target + 1] = Math.round(image.data[source + 1]! / 257);
      output[target + 2] = Math.round(image.data[source + 2]! / 257);
    }
  }
  return output;
}

function isMaskBoundary(mask: MaskImage, x: number, y: number): boolean {
  const value = mask.data[y * mask.w + x]!;
  if (value <= 0) return false;
  return (
    x === 0 ||
    y === 0 ||
    x === mask.w - 1 ||
    y === mask.h - 1 ||
    mask.data[y * mask.w + x - 1]! <= 0 ||
    mask.data[y * mask.w + x + 1]! <= 0 ||
    mask.data[(y - 1) * mask.w + x]! <= 0 ||
    mask.data[(y + 1) * mask.w + x]! <= 0
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
