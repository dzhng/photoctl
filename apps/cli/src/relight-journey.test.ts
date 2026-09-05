import { openLibrary } from "@photoctl/library";
import { FAKE_IMAGE_EDIT_MODEL } from "@photoctl/providers";
import { relightDataSchema } from "@photoctl/protocol";
import { spawnPhotoctl, startGatewayFixture } from "@photoctl/test-harness";
import type { Server } from "node:http";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, expect, test } from "vitest";

const directories: string[] = [];
let gateway: Server | undefined;
afterEach(async () => {
  if (gateway) await new Promise<void>((resolve) => gateway!.close(() => resolve()));
  gateway = undefined;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("the built CLI relights lazily through the full-frame owner and removal restores exact pixels", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-relight-journey-"));
  directories.push(directory);
  const source = join(directory, "source.png");
  const library = join(directory, "library");
  const cache = join(directory, "cache");
  await writeSource(source);
  const requests: Array<{
    path: string;
    fields: Readonly<Record<string, unknown>>;
    files: string[];
  }> = [];
  gateway = await startGatewayFixture(0, {
    imageMode: "smallerdims",
    onImageRequest: ({ path, fields, files }) =>
      requests.push({ path, fields, files: [...files].toSorted() }),
  });
  const address = gateway.address();
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
  const imported = await spawnPhotoctl(["import", source, "--copy"], { libraryDir: library, env });
  expect(imported.code, JSON.stringify(imported.json)).toBe(0);
  const id = (imported.json.data as { ids: string[] }).ids[0]!;
  const doctor = await spawnPhotoctl(["doctor"], { libraryDir: library, env });
  const libraryId = (doctor.json.data as { library_id: string }).library_id;
  const developed = await spawnPhotoctl(["develop", id, "--set", "exposure=0.25"], {
    libraryDir: library,
    env,
  });
  expect(developed.code, JSON.stringify(developed.json)).toBe(0);
  const before = await show(library, env, id);
  const beforeBytes = await readFile(before.preview);

  const mutation = await spawnPhotoctl(
    ["relight", id, "--azimuth", "35", "--elevation", "60", "--intensity", "0.75"],
    { libraryDir: library, env },
  );
  expect(mutation.code, JSON.stringify(mutation.json)).toBe(0);
  expect(mutation.events).toEqual(
    expect.arrayContaining([
      { event: "progress", phase: "relight", done: 0, total: 1 },
      { event: "progress", phase: "relight", done: 1, total: 1 },
    ]),
  );
  const changed = relightDataSchema.parse(mutation.json.data);
  expect(changed).toMatchObject({
    id,
    drift: "full-frame",
    azimuth: 35,
    elevation: 60,
    intensity: 0.75,
    generation: { returned: { w: 80, h: 60 } },
    upscale: {
      executed: true,
      target: { w: 160, h: 120 },
      final: { w: 160, h: 120 },
      density_satisfied: true,
    },
    executions: [{ kind: "generate" }, { kind: "upscale" }],
  });
  await expect(
    access(join(cache, libraryId, "view", id, changed.render_hash)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    path: "/v1/images/edits",
    fields: { model: FAKE_IMAGE_EDIT_MODEL, size: "160x120", output_format: "png" },
    files: ["image"],
  });
  expect(requests[0]!.files).not.toContain("mask");
  expect(requests[0]!.fields).not.toHaveProperty("image_url");
  expect(requests[0]!.fields).not.toHaveProperty("url");
  expect(String(requests[0]!.fields.prompt)).toContain("[photoctl:relight:v1]");
  expect(String(requests[0]!.fields.prompt)).toContain("35° azimuth");
  expect(String(requests[0]!.fields.prompt)).toContain("60° elevation");
  expect(String(requests[0]!.fields.prompt)).toContain("intensity 0.75 of 1");

  const listed = await spawnPhotoctl(["layer", "list", id], { libraryDir: library, env });
  expect(listed.json).toMatchObject({
    data: { layers: [{ id: changed.layer_id, role: "reimagine", name: "Relight 1", z: 0 }] },
  });
  const after = await show(library, env, id);
  expect(after.render_hash).toBe(changed.render_hash);
  expect(await sharp(after.preview).metadata()).toMatchObject({ width: 160, height: 120 });
  expect(await readFile(after.preview)).not.toEqual(beforeBytes);
  expect(requests).toHaveLength(1);

  const removed = await spawnPhotoctl(["layer", "remove", id, changed.layer_id], {
    libraryDir: library,
    env,
  });
  expect(removed.code, JSON.stringify(removed.json)).toBe(0);
  expect(removed.json).toMatchObject({ data: { render_hash: before.render_hash } });
  const restored = await show(library, env, id);
  expect(restored.render_hash).toBe(before.render_hash);
  expect(await readFile(restored.preview)).toEqual(beforeBytes);
  expect(requests).toHaveLength(1);
  await capture({
    source,
    before: before.preview,
    after: after.preview,
    restored: restored.preview,
  });
}, 120_000);

async function writeSource(path: string) {
  const pixels = Buffer.alloc(160 * 120 * 3);
  for (let y = 0; y < 120; y += 1)
    for (let x = 0; x < 160; x += 1) {
      const offset = (y * 160 + x) * 3;
      pixels[offset] = x;
      pixels[offset + 1] = y * 2;
      pixels[offset + 2] = (x * 3 + y * 5) % 256;
    }
  await sharp(pixels, { raw: { width: 160, height: 120, channels: 3 } })
    .png()
    .toFile(path);
}

async function show(library: string, env: NodeJS.ProcessEnv, id: string) {
  const result = await spawnPhotoctl(["show", id, "--preview-size", "native"], {
    libraryDir: library,
    env,
  });
  expect(result.code, JSON.stringify(result.json)).toBe(0);
  return result.json.data as { preview: string; render_hash: string };
}

async function capture(files: Record<string, string>) {
  const destination = process.env.PHOTOCTL_RELIGHT_CAPTURE_DIR;
  if (!destination) return;
  await mkdir(destination, { recursive: true });
  await Promise.all(
    Object.entries(files).map(
      async ([name, path]) =>
        await sharp(path)
          .png()
          .toFile(join(destination, `${name}.png`)),
    ),
  );
}
