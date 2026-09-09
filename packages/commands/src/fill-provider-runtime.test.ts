import { createGatewayImageModelAdapter, FAKE_IMAGE_EDIT_MODEL } from "@photoctl/providers";
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

test.each([
  [FAKE_IMAGE_EDIT_MODEL, { w: 383, h: 384 }, null],
  [
    "openai/gpt-image-2",
    { w: 1149, h: 1152 },
    { source: [0, 0, 383, 384], output: [0, 0, 1149, 1152] },
  ],
] as const)(
  "the built CLI uses %s with instruction-composite through real HTTP",
  async (model, returned, frameMapping) => {
    const requests: Array<{ model: unknown; mask: boolean; size: string }> = [];
    const fixture = await cliFixture({
      onImageRequest: ({ fields, files }) =>
        requests.push({ model: fields.model, mask: files.has("mask"), size: String(fields.size) }),
    });

    const filled = await spawnPhotoctl(fillArgs(fixture, model), {
      libraryDir: fixture.library,
      env: fixture.env,
    });

    expect(filled.code, JSON.stringify(filled.json)).toBe(0);
    expect(filled.json).toMatchObject({
      ok: true,
      data: {
        generation: {
          adapter: "gateway-image-instruction-composite-v1",
          model,
          returned,
        },
        composite: { unmasked_bit_exact: true },
        executions: [
          {
            kind: "generate",
            adapter: "gateway-image-instruction-composite-v1",
            model,
          },
        ],
      },
    });
    expect(requests).toEqual([{ model, mask: false, size: expect.any(String) }]);
    const generationNode = (filled.json as { data: { generation: { node: string } } }).data
      .generation.node;
    const refreshed = await spawnPhotoctl(
      ["layer", "refresh", fixture.id, fixture.layer, "--from", generationNode],
      {
        libraryDir: fixture.library,
        env: fixture.env,
      },
    );
    expect(refreshed.code, JSON.stringify(refreshed.json)).toBe(0);
    const refreshedNode = (refreshed.json as { data: { generation: { node: string } } }).data
      .generation.node;
    expect(requests.map(({ model, mask }) => ({ model, mask }))).toEqual([
      { model, mask: false },
      { model, mask: false },
    ]);
    for (const [index, node] of [generationNode, refreshedNode].entries()) {
      const [w, h] = requests[index]!.size.split("x").map(Number) as [number, number];
      const inspected = await spawnPhotoctl(["graph", "node", fixture.id, node], {
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
                adapter_version: createGatewayImageModelAdapter({ model }).version,
                model,
                target_px: w * h,
                input_px: w * h,
              },
            },
          ],
        },
      });
      expect(inspected.json).toMatchObject({
        data: {
          parameters: {
            request: {
              provider_output: { w, h },
              sent: [w, h],
              returned: [returned.w, returned.h],
              frame_mapping: frameMapping,
            },
          },
        },
      });
      const attemptId = (
        inspected.json as { data: { executions: Array<{ provider_image_attempt_id: string }> } }
      ).data.executions[0]!.provider_image_attempt_id;
      const attempt = await spawnPhotoctl(["graph", "attempt", attemptId], {
        libraryDir: fixture.library,
        env: fixture.env,
      });
      expect(attempt.json).toMatchObject({
        ok: true,
        data: {
          request: { dimensions: { w, h }, frame_mapping: frameMapping },
          original: { w, h },
        },
      });
    }
  },
  30_000,
);

test("a fixture URL alone cannot bypass unverified native-mask safety", async () => {
  let requests = 0;
  const fixture = await cliFixture({ onRequest: () => (requests += 1) });

  const filled = await spawnPhotoctl(fillArgs(fixture, "fixture/unverified-image-model"), {
    libraryDir: fixture.library,
    env: fixture.env,
  });

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
    create: { width: 383, height: 384, channels: 3, background: "#887766" },
  })
    .png()
    .toFile(source);
  server = await startGatewayFixture(0, options);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture gateway unavailable");
  const env = {
    PHOTOCTL_VOLUME_MAP: `${directory}=fill-runtime-volume:online`,
    AI_GATEWAY_API_KEY: "fixture-key",
    PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
  };
  expect((await spawnPhotoctl(["init", "--path", library], { env })).code).toBe(0);
  const imported = await spawnPhotoctl(["import", source, "--copy"], { libraryDir: library, env });
  expect(imported.code, JSON.stringify(imported.json)).toBe(0);
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0]!;
  const segmented = await spawnPhotoctl(["segment", id, "--box", "64,64,255,256"], {
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

function fillArgs(
  fixture: Awaited<ReturnType<typeof cliFixture>>,
  model: string = FAKE_IMAGE_EDIT_MODEL,
): string[] {
  return [
    "fill",
    fixture.id,
    "--layer",
    fixture.layer,
    "--remove",
    "--model",
    model,
    "--no-upscale",
  ];
}
