import { openLibrary } from "@photoctl/library";
import { generateDataSchema } from "@photoctl/protocol";
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

test("the built CLI generates, imports, tags, and lazily previews a canonical photo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-generate-journey-"));
  directories.push(directory);
  const library = join(directory, "library");
  const cache = join(directory, "cache");
  const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
  gateway = await startGatewayFixture(0, {
    imageMode: "checkerboard",
    onRequest: (request) => requests.push(request),
  });
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("Fixture gateway unavailable");
  const env = {
    AI_GATEWAY_API_KEY: "fixture-key",
    PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
    PHOTOCTL_CACHE: cache,
  };
  expect((await run("init", spawnPhotoctl(["init", "--path", library], { env }))).code).toBe(0);

  const generated = await run(
    "generate",
    spawnPhotoctl(
      ["generate", "--prompt", "color field study", "--size", "96x64", "--seed", "23"],
      { libraryDir: library, env },
    ),
  );
  expect(generated.code, JSON.stringify(generated.json)).toBe(0);
  const result = generateDataSchema.parse(generated.json.data);
  expect(result).toMatchObject({
    tag: "generated",
    requested: { w: 96, h: 64 },
    artifact: { w: 96, h: 64 },
    reference: { used: false },
    upscale: { enabled: false, executed: false },
  });
  expect(generated.events).toEqual(
    expect.arrayContaining([
      { event: "progress", phase: "generate", done: 0, total: 1 },
      { event: "progress", phase: "generate", done: 1, total: 1 },
    ]),
  );
  expect(requests).toHaveLength(1);
  const handle = await openLibrary(library, { noDaemon: true });
  const libraryId = (
    await handle.query<{ value: string }>(
      "SELECT value #>> '{}' AS value FROM settings WHERE key = 'library_id'",
    )
  ).rows[0]!.value;
  await handle.close();
  const view = join(cache, libraryId, "view", result.id, result.render_hash);
  await expect(access(view)).rejects.toMatchObject({ code: "ENOENT" });

  const shown = await run(
    "show",
    spawnPhotoctl(["show", result.id, "--preview-size", "native"], {
      libraryDir: library,
      env,
    }),
  );
  expect(shown.code, JSON.stringify(shown.json)).toBe(0);
  expect(shown.json).toMatchObject({
    data: {
      id: result.id,
      tags: ["generated"],
      dims: { w: 96, h: 64 },
      render_hash: result.render_hash,
    },
  });
  const preview = (shown.json.data as { preview: string }).preview;
  expect(await sharp(preview).metadata()).toMatchObject({ width: 96, height: 64 });
  expect(requests).toHaveLength(1);
  await capture(preview);

  const developed = await run(
    "develop",
    spawnPhotoctl(["develop", result.id, "--set", "exposure=0.25"], {
      libraryDir: library,
      env,
    }),
  );
  expect(developed.code, JSON.stringify(developed.json)).toBe(0);
  expect((developed.json.results as Array<{ render_hash: string }>)[0]!.render_hash).not.toBe(
    result.render_hash,
  );
  const developedShow = await run(
    "developed show",
    spawnPhotoctl(["show", result.id, "--preview-size", "native"], {
      libraryDir: library,
      env,
    }),
  );
  expect(developedShow.code, JSON.stringify(developedShow.json)).toBe(0);
  expect(developedShow.json).toMatchObject({ data: { develop: { exposure: 0.25 } } });
  expect(requests).toHaveLength(1);
}, 60_000);

async function capture(preview: string) {
  const destination = process.env.PHOTOCTL_GENERATE_CAPTURE_DIR;
  if (!destination) return;
  await mkdir(destination, { recursive: true });
  await sharp(await readFile(preview))
    .png()
    .toFile(join(destination, "generated.png"));
}

async function run<T>(label: string, pending: Promise<T>): Promise<T> {
  try {
    return await pending;
  } catch (error) {
    throw new Error(`${label} subprocess did not return an envelope`, { cause: error });
  }
}
