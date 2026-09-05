import { openLibrary } from "@photoctl/library";
import { FAKE_IMAGE_EDIT_MODEL } from "@photoctl/providers";
import {
  AGENT_PREVIEW_FACTS,
  spawnPhotoctl,
  startGatewayFixture,
  writeAgentPreviewFixture,
} from "@photoctl/test-harness";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, expect, test } from "vitest";

const directories: string[] = [];
let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("the built CLI keeps agent previews current through fill, opacity, retouch, generative, and markup revisions", async () => {
  const fixture = await setupFixture();
  const neutralStats = await sharp(fixture.source).stats();

  const developed = await run(fixture, ["develop", fixture.id, "--set", "exposure=0.5"]);
  expect(developed.code, JSON.stringify(developed.json)).toBe(0);
  const h1 = (developed.json.results as Array<{ render_hash: string }>)[0]!.render_hash;
  const h1Native = await show(fixture, ["--preview-size", "native"]);
  expect(h1Native).toMatchObject({
    render_hash: h1,
    preview_info: {
      actual: { region: [0, 0, 1_920, 1_280], w: 1_920, h: 1_280 },
      render_hash: h1,
      cache_source: "render_master",
      resolution_limited: false,
    },
  });
  expect(h1Native.preview.startsWith("/")).toBe(true);
  const h1MasterPixels = await rawImage(h1Native.preview);
  expect({ w: h1MasterPixels.width, h: h1MasterPixels.height }).toEqual({ w: 1_920, h: 1_280 });
  expect(meanRgb((await sharp(h1Native.preview).stats()).channels)).toBeGreaterThan(
    meanRgb(neutralStats.channels) * 1.15,
  );
  const h1MasterBefore = await fileIdentity(h1Native.preview);
  const h1ArtifactsBefore = await artifactCount(fixture.library);

  const h1Detail = await show(fixture, ["--region", AGENT_PREVIEW_FACTS.region.join(",")]);
  expect(h1Detail).toMatchObject({
    render_hash: h1,
    preview_info: {
      actual: { region: AGENT_PREVIEW_FACTS.region, w: 320, h: 384 },
      render_hash: h1,
      cache_source: "sufficient_full_frame",
      pixel_scale: 1,
    },
  });
  expect(h1Detail.preview).not.toBe(h1Native.preview);
  expect(h1Detail.preview_info.view_hash).not.toBe(h1Native.preview_info.view_hash);
  expect(await fileIdentity(h1Native.preview)).toEqual(h1MasterBefore);
  expect(await artifactCount(fixture.library)).toBe(h1ArtifactsBefore);
  const h1DetailPixels = await rawImage(h1Detail.preview);
  expect({ w: h1DetailPixels.width, h: h1DetailPixels.height }).toEqual({ w: 320, h: 384 });
  expect(detailContrast(h1DetailPixels)).toBeGreaterThan(60);
  expect(roundTrip(h1Detail.preview_info, AGENT_PREVIEW_FACTS.person.anchor)).toEqual(
    AGENT_PREVIEW_FACTS.person.anchor,
  );

  const segmented = await run(fixture, [
    "segment",
    fixture.id,
    "--box",
    AGENT_PREVIEW_FACTS.person.bbox.join(","),
  ]);
  expect(segmented.code, JSON.stringify(segmented.json)).toBe(0);
  const layer = (segmented.json.data as { layer_id: string }).layer_id;
  const filled = await run(fixture, [
    "fill",
    fixture.id,
    "--layer",
    layer,
    "--remove",
    "--pad",
    "0",
    "--model",
    FAKE_IMAGE_EDIT_MODEL,
  ]);
  expect(filled.code, JSON.stringify(filled.json)).toBe(0);
  expect(filled.json).toMatchObject({
    data: {
      graph: { layer },
      upscale: { enabled: true, executed: true, density_satisfied: true },
      composite: { unmasked_bit_exact: true },
      executions: [{ kind: "generate" }, { kind: "upscale" }],
    },
  });
  expect(fixture.gatewayRequests()).toBe(1);
  expect(await providerExecutionCount(fixture.library)).toBe(2);
  const fillData = filled.json.data as {
    graph: { render_hash: string };
    generation: { node: string };
    upscale: { node: string };
    composite: { node: string };
  };
  const h2 = fillData.graph.render_hash;
  const graph = await run(fixture, ["graph", "show", fixture.id]);
  expect(graph.code, JSON.stringify(graph.json)).toBe(0);
  const graphNodes = (graph.json.data as { nodes: Array<{ id: string; kind: string }> }).nodes;
  const resampleNode = graphNodes.find(({ kind }) => kind === "resample")?.id;
  expect(resampleNode).toMatch(/^node_[0-9a-f]{64}$/);
  expect(
    new Set([
      fillData.generation.node,
      fillData.upscale.node,
      resampleNode,
      fillData.composite.node,
    ]).size,
  ).toBe(4);
  await expect(access(viewDirectory(fixture, h2))).rejects.toMatchObject({ code: "ENOENT" });

  const h2Detail = await show(fixture, ["--region", AGENT_PREVIEW_FACTS.region.join(",")]);
  expect(h2Detail).toMatchObject({
    render_hash: h2,
    preview_info: { cache_source: "render_master", pixel_scale: 1, resolution_limited: false },
  });
  const h2Master = join(viewDirectory(fixture, h2), "master.jpg");
  await expect(access(h2Master)).resolves.toBeUndefined();
  const h2MasterBefore = await fileIdentity(h2Master);
  const h2Artifacts = await artifactCount(fixture.library);
  const repeatedH2 = await show(fixture, ["--region", AGENT_PREVIEW_FACTS.region.join(",")]);
  expect(repeatedH2.preview).toBe(h2Detail.preview);
  expect(repeatedH2.preview_info.cache_source).toBe("exact_view");
  expect(await artifactCount(fixture.library)).toBe(h2Artifacts);
  expect(fixture.gatewayRequests()).toBe(1);
  expect(await providerExecutionCount(fixture.library)).toBe(2);
  const h2Pixels = await rawImage(h2Detail.preview);
  expect({ w: h2Pixels.width, h: h2Pixels.height }).toEqual({ w: 320, h: 384 });
  expect(
    pixelDistance(
      sampleBase(h1DetailPixels, AGENT_PREVIEW_FACTS.person.anchor),
      sampleBase(h2Pixels, AGENT_PREVIEW_FACTS.person.anchor),
    ),
  ).toBeGreaterThan(35);
  expect(
    pixelDistance(
      sampleBase(h1DetailPixels, AGENT_PREVIEW_FACTS.protectedPoint),
      sampleBase(h2Pixels, AGENT_PREVIEW_FACTS.protectedPoint),
    ),
  ).toBeLessThan(8);
  const h1DetailBefore = await fileIdentity(h1Detail.preview);
  const h2DetailBefore = await fileIdentity(h2Detail.preview);

  const opacity = await run(fixture, ["layer", "set", fixture.id, layer, "--opacity", "0.5"]);
  expect(opacity.code, JSON.stringify(opacity.json)).toBe(0);
  const h3 = (opacity.json.data as { render_hash: string }).render_hash;
  expect(h3).not.toBe(h2);
  await expect(access(viewDirectory(fixture, h3))).rejects.toMatchObject({ code: "ENOENT" });

  const h3Detail = await show(fixture, ["--region", AGENT_PREVIEW_FACTS.region.join(",")]);
  expect(h3Detail).toMatchObject({
    render_hash: h3,
    preview_info: { cache_source: "render_master", pixel_scale: 1 },
  });
  const h3Pixels = await rawImage(h3Detail.preview);
  expect({ w: h3Pixels.width, h: h3Pixels.height }).toEqual({ w: 320, h: 384 });
  expect(fixture.gatewayRequests()).toBe(1);
  const person = AGENT_PREVIEW_FACTS.person.anchor;
  expect(
    pixelDistance(
      sampleBase(h3Pixels, person),
      linearLightMidpoint(sampleBase(h1DetailPixels, person), sampleBase(h2Pixels, person)),
    ),
  ).toBeLessThan(8);
  expect(await fileIdentity(h1Detail.preview)).toEqual(h1DetailBefore);
  expect(await fileIdentity(h2Detail.preview)).toEqual(h2DetailBefore);

  const h3Artifacts = await artifactCount(fixture.library);
  const h3Master = join(viewDirectory(fixture, h3), "master.jpg");
  const h3MasterBefore = await fileIdentity(h3Master);
  const overview = await show(fixture, []);
  expect(overview).toMatchObject({
    render_hash: h3,
    preview_info: { cache_source: "sufficient_full_frame", render_hash: h3 },
  });
  expect(overview.preview).not.toBe(h3Detail.preview);
  expect(await artifactCount(fixture.library)).toBe(h3Artifacts);
  expect(await fileIdentity(h3Master)).toEqual(h3MasterBefore);
  expect(fixture.gatewayRequests()).toBe(1);
  expect(await providerExecutionCount(fixture.library)).toBe(2);
  const overviewPixels = await rawImage(overview.preview);
  expect(
    pixelDistance(
      meanRegion(
        overviewPixels,
        mapRegion(overview.preview_info.base_to_view, AGENT_PREVIEW_FACTS.person.bbox),
      ),
      meanRegion(h3Pixels, relativeRegion(AGENT_PREVIEW_FACTS.person.bbox)),
    ),
  ).toBeLessThan(8);
  const protectedPoint = AGENT_PREVIEW_FACTS.protectedPoint;
  expect(
    pixelDistance(
      sample(overviewPixels, rounded(apply(overview.preview_info.base_to_view, protectedPoint))),
      sampleBase(h3Pixels, protectedPoint),
    ),
  ).toBeLessThan(8);

  await mkdir(fixture.delivery);
  const exported = await run(fixture, ["export", fixture.id, "--to", fixture.delivery]);
  expect(exported.code, JSON.stringify(exported.json)).toBe(0);
  expect(exported.json).toMatchObject({
    results: [{ id: fixture.id, ok: true, w: 1_920, h: 1_280, render_hash: h3 }],
  });
  const exportedPath = (exported.json.results as Array<{ file: string }>)[0]!.file;
  const exportedPixels = await rawImage(exportedPath);
  const h3MasterPixels = await rawImage(join(viewDirectory(fixture, h3), "master.jpg"));
  expect(meanAbsoluteDifference(exportedPixels, h3MasterPixels)).toBeLessThan(2);
  expect(await fileIdentity(h1Native.preview)).toEqual(h1MasterBefore);
  expect(await fileIdentity(h2Master)).toEqual(h2MasterBefore);
  expect(await fileIdentity(h3Master)).toEqual(h3MasterBefore);
  expect(fixture.gatewayRequests()).toBe(1);
  expect(await providerExecutionCount(fixture.library)).toBe(2);

  const retouched = await run(fixture, [
    "retouch",
    fixture.id,
    "--at",
    protectedPoint.join(","),
    "--radius",
    "8",
  ]);
  expect(retouched.code, JSON.stringify(retouched.json)).toBe(0);
  const h4 = (retouched.json.data as { render_hash: string }).render_hash;
  expect(h4).not.toBe(h3);
  await expect(access(viewDirectory(fixture, h4))).rejects.toMatchObject({ code: "ENOENT" });
  const h4Detail = await show(fixture, ["--region", AGENT_PREVIEW_FACTS.region.join(",")]);
  expect(h4Detail).toMatchObject({
    render_hash: h4,
    preview_info: { cache_source: "render_master", pixel_scale: 1 },
  });
  expect(fixture.gatewayRequests()).toBe(1);
  expect(await providerExecutionCount(fixture.library)).toBe(2);
  const h4Before = await fileIdentity(h4Detail.preview);
  const reimagined = await run(fixture, [
    "reimagine",
    fixture.id,
    "--prompt",
    "painted twilight",
    "--strength",
    "0.5",
  ]);
  expect(reimagined.code, JSON.stringify(reimagined.json)).toBe(0);
  const reimagine = reimagined.json.data as { layer_id: string; render_hash: string };
  expect(reimagine.render_hash).not.toBe(h4);
  await expect(access(viewDirectory(fixture, reimagine.render_hash))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const h5 = await show(fixture, ["--preview-size", "native"]);
  expect(h5).toMatchObject({ render_hash: reimagine.render_hash });
  expect(fixture.gatewayRequests()).toBe(2);
  expect(await providerExecutionCount(fixture.library)).toBe(4);
  const removedReimagine = await run(fixture, ["layer", "remove", fixture.id, reimagine.layer_id]);
  expect(removedReimagine).toMatchObject({
    code: 0,
    json: { data: { render_hash: h4 } },
  });
  const restoredH4 = await show(fixture, ["--region", AGENT_PREVIEW_FACTS.region.join(",")]);
  expect(restoredH4.preview).toBe(h4Detail.preview);
  expect(await fileIdentity(restoredH4.preview)).toEqual(h4Before);
  expect(fixture.gatewayRequests()).toBe(2);
  expect(await providerExecutionCount(fixture.library)).toBe(4);
  const relighted = await run(fixture, [
    "relight",
    fixture.id,
    "--azimuth",
    "35",
    "--elevation",
    "60",
    "--intensity",
    "0.75",
  ]);
  expect(relighted.code, JSON.stringify(relighted.json)).toBe(0);
  const relight = relighted.json.data as { layer_id: string; render_hash: string };
  expect(relight.render_hash).not.toBe(h4);
  await expect(access(viewDirectory(fixture, relight.render_hash))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const h6 = await show(fixture, ["--preview-size", "native"]);
  expect(h6).toMatchObject({ render_hash: relight.render_hash });
  expect(fixture.gatewayRequests()).toBe(3);
  expect(await providerExecutionCount(fixture.library)).toBe(6);
  const removedRelight = await run(fixture, ["layer", "remove", fixture.id, relight.layer_id]);
  expect(removedRelight).toMatchObject({
    code: 0,
    json: { data: { render_hash: h4 } },
  });
  const restoredAfterRelight = await show(fixture, [
    "--region",
    AGENT_PREVIEW_FACTS.region.join(","),
  ]);
  expect(restoredAfterRelight.preview).toBe(h4Detail.preview);
  expect(await fileIdentity(restoredAfterRelight.preview)).toEqual(h4Before);
  expect(fixture.gatewayRequests()).toBe(3);
  expect(await providerExecutionCount(fixture.library)).toBe(6);
  const marked = await run(fixture, [
    "markup",
    "add",
    fixture.id,
    "--json",
    JSON.stringify({
      type: "rect",
      bbox: [48, 36, 32, 24],
      width: 2,
      color: "#ff0000",
      fill: "#ff0000",
    }),
  ]);
  expect(marked.code, JSON.stringify(marked.json)).toBe(0);
  const markup = marked.json.data as {
    render_hash: string;
    items: Array<{ id: string }>;
  };
  expect(markup.render_hash).not.toBe(h4);
  await expect(access(viewDirectory(fixture, markup.render_hash))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const h7 = await show(fixture, ["--preview-size", "native"]);
  expect(h7).toMatchObject({ render_hash: markup.render_hash });
  expect(fixture.gatewayRequests()).toBe(3);
  expect(await providerExecutionCount(fixture.library)).toBe(6);
  const removedMarkup = await run(fixture, ["markup", "remove", fixture.id, markup.items[0]!.id]);
  expect(removedMarkup).toMatchObject({ code: 0, json: { data: { render_hash: h4 } } });
  const restoredAfterMarkup = await show(fixture, [
    "--region",
    AGENT_PREVIEW_FACTS.region.join(","),
  ]);
  expect(restoredAfterMarkup.preview).toBe(h4Detail.preview);
  expect(await fileIdentity(restoredAfterMarkup.preview)).toEqual(h4Before);
  await captureEvidence({
    source: fixture.source,
    h1Master: h1Native.preview,
    h1Detail: h1Detail.preview,
    h2Master,
    h2Detail: h2Detail.preview,
    h3Master,
    h3Detail: h3Detail.preview,
    h3Overview: overview.preview,
    h3Export: exportedPath,
  });
}, 120_000);

type Fixture = Awaited<ReturnType<typeof setupFixture>>;
type ShowData = {
  preview: string;
  render_hash: string;
  preview_info: {
    view_hash: string;
    cache_source: string;
    base_to_view: Matrix;
    view_to_base: Matrix;
  };
};
type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };
type RawImage = { data: Buffer; width: number; height: number };

async function setupFixture() {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-agent-preview-"));
  directories.push(directory);
  const source = join(directory, "portrait.png");
  const library = join(directory, "library");
  const cache = join(directory, "cache");
  const delivery = join(directory, "delivery");
  await writeAgentPreviewFixture(source);
  let gatewayRequests = 0;
  server = await startGatewayFixture(0, {
    imageMode: "smallerdims",
    onRequest: () => (gatewayRequests += 1),
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture gateway unavailable");
  const env = {
    AI_GATEWAY_API_KEY: "fixture-key",
    PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
    PHOTOCTL_CACHE: cache,
    PHOTOCTL_VOLUME_MAP: `${directory}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library], { env })).code).toBe(0);
  const configured = await openLibrary(library, { noDaemon: true });
  await configured.query(
    `INSERT INTO settings (key, value) VALUES
     ('models', $1::jsonb),
     ('providers', $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [
      JSON.stringify({ edit: FAKE_IMAGE_EDIT_MODEL }),
      JSON.stringify({ upscale: { "photoctl/fake-upscale-v1": { configured: true } } }),
    ],
  );
  await configured.close();
  const imported = await spawnPhotoctl(["import", source, "--link"], { libraryDir: library, env });
  expect(imported.code, JSON.stringify(imported.json)).toBe(0);
  const id = (imported.json.data as { ids: string[] }).ids[0]!;
  const doctor = await spawnPhotoctl(["doctor"], { libraryDir: library, env });
  const libraryId = (doctor.json.data as { library_id: string }).library_id;
  return {
    directory,
    source,
    library,
    cache,
    delivery,
    env,
    id,
    libraryId,
    gatewayRequests: () => gatewayRequests,
  };
}

async function run(fixture: Fixture, args: string[]) {
  return await spawnPhotoctl(args, { libraryDir: fixture.library, env: fixture.env });
}

async function show(fixture: Fixture, args: string[]): Promise<ShowData> {
  const shown = await run(fixture, ["show", fixture.id, ...args]);
  expect(shown.code, JSON.stringify(shown.json)).toBe(0);
  return shown.json.data as ShowData;
}

function viewDirectory(fixture: Fixture, renderHash: string): string {
  return join(fixture.cache, fixture.libraryId, "view", fixture.id, renderHash);
}

async function artifactCount(library: string): Promise<number> {
  const handle = await openLibrary(library, { noDaemon: true });
  try {
    const result = await handle.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM image_artifacts WHERE artifact_available = true",
    );
    return Number(result.rows[0]!.count);
  } finally {
    await handle.close();
  }
}

async function providerExecutionCount(library: string): Promise<number> {
  const handle = await openLibrary(library, { noDaemon: true });
  try {
    const result = await handle.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM node_executions AS execution
       JOIN image_nodes AS node ON node.photo_id = execution.photo_id AND node.id = execution.node_id
       WHERE node.kind IN ('generate', 'upscale')`,
    );
    return Number(result.rows[0]!.count);
  } finally {
    await handle.close();
  }
}

async function fileIdentity(path: string): Promise<{ hash: string; mtimeMs: number }> {
  const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
  return {
    hash: createHash("sha256").update(bytes).digest("hex"),
    mtimeMs: metadata.mtimeMs,
  };
}

async function rawImage(path: string): Promise<RawImage> {
  const { data, info } = await sharp(path)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function sampleBase(image: RawImage, point: readonly [number, number]): number[] {
  const [regionX, regionY] = AGENT_PREVIEW_FACTS.region;
  return sample(image, [point[0] - regionX, point[1] - regionY]);
}

function sample(image: RawImage, point: readonly [number, number]): number[] {
  const offset = (point[1] * image.width + point[0]) * 3;
  return [image.data[offset]!, image.data[offset + 1]!, image.data[offset + 2]!];
}

function meanRegion(
  image: RawImage,
  [x, y, width, height]: readonly [number, number, number, number],
): number[] {
  const sums = [0, 0, 0];
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const values = sample(image, [column, row]);
      for (let channel = 0; channel < 3; channel += 1) sums[channel] += values[channel]!;
    }
  }
  return sums.map((sum) => sum / (width * height));
}

function relativeRegion([x, y, width, height]: readonly [number, number, number, number]): [
  number,
  number,
  number,
  number,
] {
  return [x - AGENT_PREVIEW_FACTS.region[0], y - AGENT_PREVIEW_FACTS.region[1], width, height];
}

function mapRegion(
  matrix: Matrix,
  [x, y, width, height]: readonly [number, number, number, number],
): [number, number, number, number] {
  const topLeft = rounded(apply(matrix, [x, y]));
  const bottomRight = rounded(apply(matrix, [x + width, y + height]));
  return [topLeft[0], topLeft[1], bottomRight[0] - topLeft[0], bottomRight[1] - topLeft[1]];
}

function detailContrast(image: RawImage): number {
  return pixelDistance(
    sampleBase(image, AGENT_PREVIEW_FACTS.person.detailA),
    sampleBase(image, AGENT_PREVIEW_FACTS.person.detailB),
  );
}

function pixelDistance(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + Math.abs(value - right[index]!), 0) / 3;
}

function linearLightMidpoint(left: number[], right: number[]): number[] {
  return left.map((value, index) => {
    const midpoint = (srgbToLinear(value) + srgbToLinear(right[index]!)) / 2;
    const encoded =
      midpoint <= 0.0031308 ? midpoint * 12.92 : 1.055 * midpoint ** (1 / 2.4) - 0.055;
    return encoded * 255;
  });
}

function srgbToLinear(value: number): number {
  const encoded = value / 255;
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

function meanAbsoluteDifference(left: RawImage, right: RawImage): number {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(
      `Cannot compare ${left.width}x${left.height} pixels with ${right.width}x${right.height}`,
    );
  }
  return (
    left.data.reduce((sum, value, index) => sum + Math.abs(value - right.data[index]!), 0) /
    left.data.length
  );
}

function meanRgb(channels: Array<{ mean: number }>): number {
  return channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
}

function roundTrip(info: ShowData["preview_info"], point: readonly [number, number]): number[] {
  const view = apply(info.base_to_view, point);
  return apply(info.view_to_base, view).map((value) => Math.round(value));
}

function apply(matrix: Matrix, point: readonly [number, number]): number[] {
  return [
    matrix.a * point[0] + matrix.c * point[1] + matrix.e,
    matrix.b * point[0] + matrix.d * point[1] + matrix.f,
  ];
}

function rounded(point: number[]): [number, number] {
  return [Math.round(point[0]!), Math.round(point[1]!)];
}

async function captureEvidence(paths: Record<string, string>): Promise<void> {
  const output = process.env.PHOTOCTL_AGENT_PREVIEW_CAPTURE_DIR;
  if (!output) return;
  await mkdir(output, { recursive: true });
  await Promise.all(
    Object.entries(paths).map(async ([name, path]) => {
      await sharp(path)
        .png()
        .toFile(join(output, `${name}.png`));
    }),
  );
}
