import { openLibrary } from "@photoctl/library";
import { artifactPath, readArtifactLinear } from "@photoctl/render";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, expect, test } from "vitest";

const directories: string[] = [];
afterEach(
  async () => await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))),
);

test("the built CLI flattens markup lazily and removing the item restores exact prior pixels", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-markup-journey-"));
  directories.push(parent);
  const source = join(parent, "source.png");
  const library = join(parent, "library");
  const cache = join(parent, "cache");
  const raw = Buffer.alloc(80 * 60 * 3);
  for (let y = 0; y < 60; y += 1)
    for (let x = 0; x < 80; x += 1) {
      const offset = (y * 80 + x) * 3;
      raw[offset] = 30 + x;
      raw[offset + 1] = 35 + y;
      raw[offset + 2] = 60;
    }
  await sharp(raw, { raw: { width: 80, height: 60, channels: 3 } })
    .png()
    .toFile(source);
  const env = { PHOTOCTL_CACHE: cache, PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:online` };
  expect((await spawnPhotoctl(["init", "--path", library], { env })).code).toBe(0);
  const imported = await spawnPhotoctl(["import", source, "--link"], { libraryDir: library, env });
  const id = (imported.json.data as { ids: string[] }).ids[0]!;
  const doctor = await spawnPhotoctl(["doctor"], { libraryDir: library, env });
  const libraryId = (doctor.json.data as { library_id: string }).library_id;
  const before = await show(library, env, id);
  const beforeBytes = await readFile(before.preview);
  const primitive = {
    type: "rect",
    bbox: [20, 15, 30, 20],
    width: 2,
    color: "#ff0000",
    fill: "#ff0000",
  };
  const added = await spawnPhotoctl(["markup", "add", id, "--json", JSON.stringify(primitive)], {
    libraryDir: library,
    env,
  });
  expect(added.code, JSON.stringify(added.json)).toBe(0);
  expect(added.json).toMatchObject({
    data: { id, changed: "add", items: [{ ...primitive, id: expect.any(String) }] },
  });
  const data = added.json.data as {
    node: string;
    render_hash: string;
    items: Array<{ id: string }>;
  };
  await expect(access(join(cache, libraryId, "view", id, data.render_hash))).rejects.toMatchObject({
    code: "ENOENT",
  });

  const after = await show(library, env, id);
  expect(after.render_hash).toBe(data.render_hash);
  expect(await readFile(after.preview)).not.toEqual(beforeBytes);
  const canonical = await assertCanonicalRectBoundary(library, data.node, [20, 15, 30, 20]);

  const removed = await spawnPhotoctl(["markup", "remove", id, data.items[0]!.id], {
    libraryDir: library,
    env,
  });
  expect(removed.code, JSON.stringify(removed.json)).toBe(0);
  expect(removed.json).toMatchObject({
    data: { id, changed: "remove", items: [], render_hash: before.render_hash },
  });
  const restored = await show(library, env, id);
  expect(await readFile(restored.preview)).toEqual(beforeBytes);

  const cropped = await spawnPhotoctl(
    ["develop", id, "--set", 'crop={"x":10,"y":5,"w":40,"h":30}', "rotate=90"],
    { libraryDir: library, env },
  );
  expect(cropped.code, JSON.stringify(cropped.json)).toBe(0);
  const projectedAdd = await spawnPhotoctl(
    ["markup", "add", id, "--json", JSON.stringify(primitive)],
    { libraryDir: library, env },
  );
  expect(projectedAdd.code, JSON.stringify(projectedAdd.json)).toBe(0);
  const projectedData = projectedAdd.json.data as { node: string };
  const projected = await show(library, env, id);
  const projectedCanonical = await canonicalPair(library, projectedData.node);
  const projectedPixels = await sharp(projected.preview).removeAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  expect(projectedPixels.info).toMatchObject({ width: 30, height: 40, channels: 3 });
  const center = pixel(projectedPixels.data, projectedPixels.info.width, 10, 20);
  const outside = pixel(projectedPixels.data, projectedPixels.info.width, 25, 2);
  expect(center[0]).toBeGreaterThan(center[1] + 80);
  expect(center[0]).toBeGreaterThan(center[2] + 80);
  expect(outside[0]).toBeLessThan(outside[1] + 80);

  const capture = process.env.PHOTOCTL_MARKUP_CAPTURE_DIR;
  if (capture) {
    await mkdir(capture, { recursive: true });
    await Promise.all([
      writeLinearPng(canonical.input, join(capture, "before.png")),
      writeLinearPng(canonical.output, join(capture, "after.png")),
      writeLinearPng(canonical.input, join(capture, "restored.png")),
      writeLinearPng(projectedCanonical.input, join(capture, "projected-before.png")),
      writeLinearPng(projectedCanonical.output, join(capture, "projected.png")),
    ]);
  }
}, 120_000);

async function show(library: string, env: Record<string, string>, id: string) {
  const shown = await spawnPhotoctl(["show", id, "--preview-size", "native"], {
    libraryDir: library,
    env,
  });
  expect(shown.code, JSON.stringify(shown.json)).toBe(0);
  return shown.json.data as { preview: string; render_hash: string };
}

function pixel(data: Buffer, width: number, x: number, y: number) {
  const offset = (y * width + x) * 3;
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!];
}

async function assertCanonicalRectBoundary(
  library: string,
  nodeId: string,
  bbox: [number, number, number, number],
) {
  const pair = await canonicalPair(library, nodeId);
  const { input, output } = pair;
  let changedInside = 0;
  for (let y = 0; y < input.h; y += 1)
    for (let x = 0; x < input.w; x += 1)
      for (let channel = 0; channel < 3; channel += 1) {
        const index = (y * input.w + x) * 3 + channel;
        const inside =
          x >= bbox[0] && x < bbox[0] + bbox[2] && y >= bbox[1] && y < bbox[1] + bbox[3];
        if (inside) changedInside += Number(input.data[index] !== output.data[index]);
        else expect(output.data[index]).toBe(input.data[index]);
      }
  expect(changedInside).toBeGreaterThan(0);
  return pair;
}

async function canonicalPair(library: string, nodeId: string) {
  const db = await openLibrary(library, { noDaemon: true });
  try {
    const execution = (
      await db.query<{ output_artifact_hash: string; execution_id: string }>(
        "SELECT output_artifact_hash, execution_id FROM node_executions WHERE node_id = $1",
        [nodeId],
      )
    ).rows[0]!;
    const inputHash = (
      await db.query<{ input_artifact_hash: string }>(
        "SELECT input_artifact_hash FROM node_execution_inputs WHERE execution_id = $1 AND input_index = 0",
        [execution.execution_id],
      )
    ).rows[0]!.input_artifact_hash;
    const [input, output] = await Promise.all([
      readArtifactLinear(artifactPath(db.path, inputHash, "tif"), inputHash),
      readArtifactLinear(
        artifactPath(db.path, execution.output_artifact_hash, "tif"),
        execution.output_artifact_hash,
      ),
    ]);
    return { input, output };
  } finally {
    await db.close();
  }
}

async function writeLinearPng(image: Awaited<ReturnType<typeof readArtifactLinear>>, path: string) {
  const display = Uint8Array.from(image.data, (sample) =>
    Math.round(Math.min(1, Math.max(0, sample)) * 255),
  );
  await sharp(display, { raw: { width: image.w, height: image.h, channels: 3 } })
    .png()
    .toFile(path);
}
