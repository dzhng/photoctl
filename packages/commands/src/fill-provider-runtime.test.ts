import { FAKE_IMAGE_EDIT_MODEL } from "@photoctl/providers";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { mkdtemp, rm } from "node:fs/promises";
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

test("the built CLI reaches the reserved instruction-composite profile through real HTTP", async () => {
  const fixture = await cliFixture();

  const filled = await spawnPhotoctl(fillArgs(fixture), {
    libraryDir: fixture.library,
    env: fixture.env,
  });

  expect(filled.code, JSON.stringify(filled.json)).toBe(0);
  expect(filled.json).toMatchObject({
    ok: true,
    data: {
      generation: {
        adapter: "gateway-image-instruction-composite-v1",
        model: FAKE_IMAGE_EDIT_MODEL,
      },
      composite: { unmasked_bit_exact: true },
      executions: [
        {
          kind: "generate",
          adapter: "gateway-image-instruction-composite-v1",
          model: FAKE_IMAGE_EDIT_MODEL,
        },
      ],
    },
  });
  const generationNode = (filled.json as { data: { generation: { node: string } } }).data.generation
    .node;
  const inspected = await spawnPhotoctl(["graph", "node", fixture.id, generationNode], {
    libraryDir: fixture.library,
    env: fixture.env,
  });
  expect(inspected.code, JSON.stringify(inspected.json)).toBe(0);
  expect(inspected.json).toMatchObject({
    ok: true,
    data: {
      kind: "generate",
      executions: [
        {
          provider_provenance: {
            adapter: "gateway-image-instruction-composite-v1",
            adapter_version: "1",
            model: FAKE_IMAGE_EDIT_MODEL,
          },
        },
      ],
    },
  });
}, 30_000);

test("a fixture URL alone cannot bypass unverified native-mask safety", async () => {
  let requests = 0;
  const fixture = await cliFixture({ onRequest: () => (requests += 1) });

  const filled = await spawnPhotoctl(
    ["fill", fixture.id, "--layer", fixture.layer, "--remove", "--no-upscale"],
    { libraryDir: fixture.library, env: fixture.env },
  );

  expect(filled.code).toBe(69);
  expect(filled.json).toMatchObject({ ok: false, code: "provider_unverified_mask" });
  expect(requests).toBe(0);
}, 30_000);

test.each([
  ["wrong-aspect", "wrongaspect"],
  ["reported whole-frame", "wholeframe"],
] as const)(
  "a %s fixture response leaves the active revision unchanged",
  async (_case, imageMode) => {
    const fixture = await cliFixture({ imageMode });
    const before = await graphRevision(fixture);

    const filled = await spawnPhotoctl(fillArgs(fixture), {
      libraryDir: fixture.library,
      env: fixture.env,
    });

    expect(filled.code).toBe(65);
    expect(filled.json).toMatchObject({ ok: false, code: "provider_whole_frame" });
    expect(await graphRevision(fixture)).toBe(before);
  },
  30_000,
);

async function cliFixture(options: Parameters<typeof startGatewayFixture>[1] = {}) {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-fill-provider-runtime-"));
  directories.push(directory);
  const library = join(directory, "library");
  const source = join(directory, "source.png");
  await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#887766" },
  })
    .png()
    .toFile(source);
  server = await startGatewayFixture(0, options);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture gateway unavailable");
  const env = {
    AI_GATEWAY_API_KEY: "fixture-key",
    PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
  };
  expect((await spawnPhotoctl(["init", "--path", library], { env })).code).toBe(0);
  const imported = await spawnPhotoctl(["import", source, "--copy"], { libraryDir: library, env });
  expect(imported.code, JSON.stringify(imported.json)).toBe(0);
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0]!;
  const segmented = await spawnPhotoctl(["segment", id, "--box", "8,6,8,8"], {
    libraryDir: library,
    env,
  });
  expect(segmented.code, JSON.stringify(segmented.json)).toBe(0);
  const layer = (segmented.json as { data: { layer_id: string } }).data.layer_id;
  return { library, env, id, layer };
}

async function graphRevision(fixture: Awaited<ReturnType<typeof cliFixture>>): Promise<string> {
  const shown = await spawnPhotoctl(["graph", "show", fixture.id], {
    libraryDir: fixture.library,
    env: fixture.env,
  });
  expect(shown.code, JSON.stringify(shown.json)).toBe(0);
  return (shown.json as { data: { revision_id: string } }).data.revision_id;
}

function fillArgs(fixture: Awaited<ReturnType<typeof cliFixture>>): string[] {
  return [
    "fill",
    fixture.id,
    "--layer",
    fixture.layer,
    "--remove",
    "--model",
    FAKE_IMAGE_EDIT_MODEL,
    "--no-upscale",
  ];
}
