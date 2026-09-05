import { openLibrary } from "@photoctl/library";
import { artifactPath, readArtifactLinear, readArtifactMask } from "@photoctl/render";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, expect, test } from "vitest";

const directories: string[] = [];
afterEach(
  async () => await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))),
);

test("the built CLI retouches once, materializes lazily, and exports the current pixels", async () => {
  const fixture = await setup();
  const before = await show(fixture, ["--preview-size", "native"]);
  const changed = await run(fixture, [
    "retouch",
    fixture.id,
    "--at",
    "0.5,0.5",
    "--radius",
    "0.06",
    "--norm",
  ]);
  expect(changed.code, JSON.stringify(changed.json)).toBe(0);
  expect(changed.json).toMatchObject({
    data: { id: fixture.id, at: [80, 60], radius: 9.6, reused: false },
  });
  const data = changed.json.data as {
    layer_id: string;
    revision_id: string;
    render_hash: string;
    node: string;
  };
  await expect(
    access(join(fixture.cache, fixture.libraryId, "view", fixture.id, data.render_hash)),
  ).rejects.toMatchObject({ code: "ENOENT" });

  const listed = await run(fixture, ["layer", "list", fixture.id]);
  expect(listed.json).toMatchObject({
    data: { revision_id: data.revision_id, layers: [{ id: data.layer_id, role: "retouch", z: 0 }] },
  });
  const inspected = await run(fixture, ["layer", "show", fixture.id, data.layer_id]);
  expect(
    (inspected.json.data as { chain: { content: Array<{ kind: string }> } }).chain.content.map(
      ({ kind }) => kind,
    ),
  ).toContain("heal");

  const repeated = await run(fixture, ["retouch", fixture.id, "--at", "80,60", "--radius", "9.6"]);
  expect(repeated.json).toEqual({
    ...changed.json,
    data: { ...(changed.json.data as object), reused: true },
  });
  const after = await show(fixture, ["--preview-size", "native"]);
  expect(after.render_hash).toBe(data.render_hash);
  await assertCanonicalBoundary(fixture.library, data.node);

  await mkdir(fixture.delivery);
  const exported = await run(fixture, [
    "export",
    fixture.id,
    "--to",
    fixture.delivery,
    "--format",
    "png",
  ]);
  expect(exported.code, JSON.stringify(exported.json)).toBe(0);
  expect(exported.json).toMatchObject({
    results: [{ id: fixture.id, ok: true, w: 160, h: 120, render_hash: data.render_hash }],
  });
  const exportedPath = (exported.json.results as Array<{ file: string }>)[0]!.file;
  expect(await sharp(exportedPath).metadata()).toMatchObject({
    width: 160,
    height: 120,
    format: "png",
  });
  expect(await meanAbsoluteDifference(after.preview, exportedPath)).toBeLessThan(3);
  await capture({
    source: fixture.source,
    before: before.preview,
    after: after.preview,
    export: exportedPath,
  });
}, 120_000);

test("oriented uncropped retouch coordinates map into the current cropped rotation", async () => {
  const fixture = await setup();
  const developed = await run(fixture, [
    "develop",
    fixture.id,
    "--set",
    'crop={"x":40,"y":20,"w":80,"h":80}',
    "rotate=90",
  ]);
  expect(developed.code, JSON.stringify(developed.json)).toBe(0);
  const changed = await run(fixture, ["retouch", fixture.id, "--at", "80,60", "--radius", "9.6"]);
  expect(changed.code, JSON.stringify(changed.json)).toBe(0);
  const data = changed.json.data as { node: string; render_hash: string };
  const current = await show(fixture, ["--preview-size", "native"]);
  expect(current.render_hash).toBe(data.render_hash);
  expect(await sharp(current.preview).metadata()).toMatchObject({ width: 80, height: 80 });
  await assertCanonicalBoundary(fixture.library, data.node);
  await mkdir(fixture.delivery);
  const exported = await run(fixture, [
    "export",
    fixture.id,
    "--to",
    fixture.delivery,
    "--format",
    "png",
  ]);
  expect(exported.code, JSON.stringify(exported.json)).toBe(0);
  const exportedPath = (exported.json.results as Array<{ file: string }>)[0]!.file;
  expect(await sharp(exportedPath).metadata()).toMatchObject({ width: 80, height: 80 });
}, 120_000);

test("a real orientation-6 import uses its persisted oriented coordinate space", async () => {
  const fixture = await setup({ orientation: 6 });
  const changed = await run(fixture, [
    "retouch",
    fixture.id,
    "--at",
    "0.5,0.5",
    "--radius",
    "0.05",
    "--norm",
  ]);
  expect(changed.code, JSON.stringify(changed.json)).toBe(0);
  expect(changed.json).toMatchObject({ data: { at: [60, 80], radius: 8 } });
  const data = changed.json.data as { node: string; render_hash: string };
  const current = await show(fixture, ["--preview-size", "native"]);
  expect(current.render_hash).toBe(data.render_hash);
  expect(await sharp(current.preview).metadata()).toMatchObject({ width: 120, height: 160 });
  await assertCanonicalBoundary(fixture.library, data.node);
}, 120_000);

async function meanAbsoluteDifference(left: string, right: string): Promise<number> {
  const [a, b] = await Promise.all([
    sharp(left).removeAlpha().raw().toBuffer(),
    sharp(right).removeAlpha().raw().toBuffer(),
  ]);
  expect(a.length).toBe(b.length);
  let total = 0;
  for (let index = 0; index < a.length; index += 1) total += Math.abs(a[index]! - b[index]!);
  return total / a.length;
}

async function setup(options: { orientation?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-retouch-journey-"));
  directories.push(directory);
  const source = join(directory, options.orientation ? "source.jpg" : "source.png"),
    library = join(directory, "library"),
    cache = join(directory, "cache"),
    delivery = join(directory, "delivery");
  const raw = Buffer.alloc(160 * 120 * 3);
  for (let y = 0; y < 120; y += 1)
    for (let x = 0; x < 160; x += 1) {
      const i = (y * 160 + x) * 3;
      raw[i] = x;
      raw[i + 1] = y * 2;
      raw[i + 2] = (x + y) % 256;
      if (x >= 74 && x < 86 && y >= 54 && y < 66) {
        raw[i] = 250;
        raw[i + 1] = 20;
        raw[i + 2] = 20;
      }
    }
  const image = sharp(raw, { raw: { width: 160, height: 120, channels: 3 } });
  if (options.orientation) {
    await image
      .withMetadata({ orientation: options.orientation })
      .jpeg({ quality: 100 })
      .toFile(source);
  } else {
    await image.png().toFile(source);
  }
  const env = { PHOTOCTL_CACHE: cache, PHOTOCTL_VOLUME_MAP: `${directory}=fixture-volume:online` };
  expect((await spawnPhotoctl(["init", "--path", library], { env })).code).toBe(0);
  const imported = await spawnPhotoctl(["import", source, "--link"], { libraryDir: library, env });
  const id = (imported.json.data as { ids: string[] }).ids[0]!;
  const doctor = await spawnPhotoctl(["doctor"], { libraryDir: library, env });
  return {
    source,
    library,
    cache,
    delivery,
    env,
    id,
    libraryId: (doctor.json.data as { library_id: string }).library_id,
  };
}
async function run(fixture: Awaited<ReturnType<typeof setup>>, args: string[]) {
  return await spawnPhotoctl(args, { libraryDir: fixture.library, env: fixture.env });
}
async function show(fixture: Awaited<ReturnType<typeof setup>>, args: string[]) {
  const result = await run(fixture, ["show", fixture.id, ...args]);
  expect(result.code, JSON.stringify(result.json)).toBe(0);
  return result.json.data as { preview: string; render_hash: string };
}

async function assertCanonicalBoundary(library: string, node: string) {
  const db = await openLibrary(library, { noDaemon: true });
  try {
    const execution = await db.query<{ output_artifact_hash: string }>(
      "SELECT output_artifact_hash FROM node_executions WHERE node_id = $1",
      [node],
    );
    const inputs = await db.query<{ input_index: number; input_artifact_hash: string }>(
      "SELECT input_index, input_artifact_hash FROM node_execution_inputs WHERE execution_id = (SELECT execution_id FROM node_executions WHERE node_id = $1) ORDER BY input_index",
      [node],
    );
    const input = await readArtifactLinear(
      artifactPath(db.path, inputs.rows[0]!.input_artifact_hash, "tif"),
      inputs.rows[0]!.input_artifact_hash,
    );
    const mask = await readArtifactMask(
      artifactPath(db.path, inputs.rows[1]!.input_artifact_hash, "tif"),
      inputs.rows[1]!.input_artifact_hash,
    );
    const outputHash = execution.rows[0]!.output_artifact_hash;
    const output = await readArtifactLinear(artifactPath(db.path, outputHash, "tif"), outputHash);
    let insideChanged = false;
    for (let pixel = 0; pixel < mask.data.length; pixel += 1)
      for (let channel = 0; channel < 3; channel += 1) {
        const index = pixel * 3 + channel;
        if (mask.data[pixel]! <= 0) expect(output.data[index]).toBe(input.data[index]);
        else if (output.data[index] !== input.data[index]) insideChanged = true;
      }
    expect(insideChanged).toBe(true);
  } finally {
    await db.close();
  }
}
async function capture(files: Record<string, string>) {
  const destination = process.env.PHOTOCTL_RETOUCH_CAPTURE_DIR;
  if (!destination) return;
  await mkdir(destination, { recursive: true });
  await Promise.all(
    Object.entries(files).flatMap(([name, path]) => [
      sharp(path)
        .png()
        .toFile(join(destination, `${name}.png`)),
      sharp(path)
        .extract({ left: 56, top: 36, width: 48, height: 48 })
        .resize(192, 192, { kernel: "nearest" })
        .png()
        .toFile(join(destination, `${name}-detail.png`)),
    ]),
  );
}
