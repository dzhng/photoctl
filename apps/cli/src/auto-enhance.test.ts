import { openLibrary } from "@photoctl/library";
import { spawnPhotoctl, startGatewayFixture } from "@photoctl/test-harness";
import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

const directories: string[] = [];
let gateway: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolveClose) => gateway?.close(() => resolveClose()) ?? resolveClose());
  gateway = undefined;
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("the built CLI applies one clamped auto-enhance batch and undo restores the prior develop", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-auto-enhance-"));
  directories.push(parent);
  const library = join(parent, "library");
  const cache = join(parent, "cache");
  const source = join(parent, "source.jpg");
  await sharp({
    create: { width: 1_600, height: 900, channels: 3, background: "#807060" },
  })
    .jpeg()
    .toFile(source);
  const requests: Array<Record<string, unknown>> = [];
  gateway = await startGatewayFixture(0, {
    structuredResponse: {
      exposure: 3,
      highlights: -140,
      shadows: 24,
      contrast: -12,
      black_point: 7,
      vibrance: 18,
      saturation: -4,
      white_balance: { temp_offset_k: 2_000 },
    },
    onRequest: ({ path, body }) => {
      if (path === "/v1/chat/completions" && body) requests.push(body);
    },
  });
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("gateway did not bind TCP");
  const env = {
    PHOTOCTL_NO_DAEMON: "1",
    PHOTOCTL_CACHE: cache,
    PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:online`,
    AI_GATEWAY_API_KEY: "fixture-key",
    PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
  };
  expect((await spawnPhotoctl(["init"], { libraryDir: library, env })).code).toBe(0);
  const imported = await spawnPhotoctl(["import", source, "--link"], {
    libraryDir: library,
    env,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0]!;
  expect(
    await spawnPhotoctl(["develop", id, "--set", "contrast=9"], { libraryDir: library, env }),
  ).toMatchObject({ code: 0 });
  const before = await spawnPhotoctl(["show", id, "--preview-size", "1024"], {
    libraryDir: library,
    env,
  });
  const beforePixels = await sharp((before.json as { data: { preview: string } }).data.preview)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const enhanced = await spawnPhotoctl(["develop", id, "--auto-enhance"], {
    libraryDir: library,
    env: { ...env, PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:offline` },
  });
  expect(enhanced.code, JSON.stringify(enhanced.json)).toBe(0);
  expect(enhanced).toMatchObject({
    code: 0,
    json: {
      ok: true,
      results: [{ id, ok: true }],
      warnings: [{ code: "source_offline", id }],
    },
  });
  const shown = await spawnPhotoctl(["show", id, "--preview-size", "1024"], {
    libraryDir: library,
    env,
  });
  expect(shown.json).toMatchObject({
    ok: true,
    data: {
      develop: {
        exposure: 2,
        highlights: -100,
        shadows: 24,
        contrast: -12,
        black_point: 7,
        vibrance: 18,
        saturation: -4,
        white_balance: { temp_offset_k: 1_500 },
      },
    },
  });
  const afterPixels = await sharp((shown.json as { data: { preview: string } }).data.preview)
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(afterPixels.info).toMatchObject({
    width: beforePixels.info.width,
    height: beforePixels.info.height,
    channels: beforePixels.info.channels,
  });
  expect(afterPixels.data.equals(beforePixels.data)).toBe(false);

  expect(requests).toHaveLength(1);
  expect(requests[0]!.response_format).toMatchObject({
    type: "json_schema",
    json_schema: {
      name: "photoctl_auto_enhance",
      strict: true,
      schema: { type: "object", additionalProperties: false, minProperties: 1 },
    },
  });
  const content = (
    requests[0]!.messages as Array<{
      content: Array<{ type: string; text?: string; image_url?: { url: string } }>;
    }>
  )[0]!.content;
  const stats = JSON.parse(
    content
      .find(({ type }) => type === "text")!
      .text!.split("\n")
      .at(-1)!,
  ) as Record<string, unknown>;
  expect(stats).toEqual({
    p02: expect.any(Number),
    p50: expect.any(Number),
    p98: expect.any(Number),
    clipped_lo_pct: expect.any(Number),
    clipped_hi_pct: expect.any(Number),
    mean_sat: expect.any(Number),
    est_wb_k: expect.any(Number),
  });
  const imageUrl = content.find(({ type }) => type === "image_url")!.image_url!.url;
  await expect(
    sharp(Buffer.from(imageUrl.split(",")[1]!, "base64")).metadata(),
  ).resolves.toMatchObject({
    width: 1024,
  });

  expect(
    await spawnPhotoctl(["develop", id, "--undo-auto"], { libraryDir: library, env }),
  ).toMatchObject({ code: 0, json: { ok: true, results: [{ id, ok: true }] } });
  expect(await spawnPhotoctl(["show", id], { libraryDir: library, env })).toMatchObject({
    json: { ok: true, data: { develop: { contrast: 9 } } },
  });
  const handle = await openLibrary(library);
  expect(
    (
      await handle.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata
         FROM document_revisions
         WHERE photo_id = $1 AND metadata ? 'develop_before_auto'`,
        [id],
      )
    ).rows,
  ).toMatchObject([
    {
      metadata: {
        auto_enhance_version: 1,
        develop_before_auto: { contrast: 9 },
        provider_execution: {
          operation: "auto-enhance",
          adapter: "gateway-structured-v1",
          adapter_version: "1",
          model: "google/gemini-3.1-flash",
          provider_request_id: expect.stringMatching(/^req_/),
          attempt: 1,
          prompt_version: 1,
          preview: { w: 1024, h: 576 },
          stats: {
            p02: expect.any(Number),
            p50: expect.any(Number),
            p98: expect.any(Number),
            clipped_lo_pct: expect.any(Number),
            clipped_hi_pct: expect.any(Number),
            mean_sat: expect.any(Number),
            est_wb_k: expect.any(Number),
          },
        },
      },
    },
  ]);
  await handle.close();
}, 30_000);
