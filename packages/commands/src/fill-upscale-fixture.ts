import { initializeLibrary } from "@photoctl/library";
import {
  FakeUpscaleAdapter,
  GatewayClient,
  GatewayImageModelAdapter,
  UpscaleRegistry,
  type FakeUpscaleMode,
} from "@photoctl/providers";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect } from "vitest";
import { dispatch } from "./dispatch.js";

export async function fillUpscaleFixture(
  options: {
    generationMode?: "smallerdims" | "wrongdims";
    upscaleMode?: FakeUpscaleMode;
    upscaleConfigured?: boolean;
    upscaleLimits?: NonNullable<ConstructorParameters<typeof FakeUpscaleAdapter>[0]>["limits"];
    intrinsicDivisor?: 2 | 4;
    generationUpscale?: "auto" | "off";
    libraryUpscaleModel?: string;
    sourceContext?: { tier: string; pixelScale: number; resolutionLimited: boolean };
  } = {},
) {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-fill-upscale-"));
  const source = join(parent, "source.png");
  await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#406080" },
  })
    .png()
    .toFile(source);
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  const env = {
    noDaemon: true,
    cacheRoot: join(parent, "cache"),
    volumeMap: `${parent}=fixture-volume:online`,
  };
  const imported = success(
    await dispatch(
      { verb: "import", args: [source, "--link"], cwd: parent, env },
      { version: "test", library: handle },
    ),
  ) as { ids: string[] };
  const server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture gateway unavailable");
  const rawGateway = new GatewayClient({
    apiKey: "fixture-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  });
  let generationCalls = 0;
  const gateway = {
    imageEdits: async (form: FormData) => {
      generationCalls += 1;
      if (options.generationMode) form.set("fixture_mode", options.generationMode);
      return await rawGateway.imageEdits(form);
    },
  };
  const fake = new FakeUpscaleAdapter({
    mode: options.upscaleMode,
    limits: options.upscaleLimits,
  });
  let upscaleCalls = 0;
  const createRegistry = (version: string) => {
    const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
    registry.register({
      id: fake.id,
      version,
      colorContract: fake.colorContract,
      supportedScales: fake.supportedScales,
      limits: fake.limits,
      upscale: async (input: Parameters<FakeUpscaleAdapter["upscale"]>[0]) => {
        upscaleCalls += 1;
        const value = await fake.upscale(input);
        return {
          ...value,
          provenance: { ...value.provenance, adapterVersion: version },
        };
      },
    });
    return registry;
  };
  const registry = createRegistry("1");
  const sourceProducer = async () => ({
    image: {
      w: 40,
      h: 30,
      data: new Float32Array(40 * 30 * 3).fill(0.25),
      orientationApplied: true as const,
      space: "scene-linear-rec2020" as const,
      whiteLevel: 1,
      blackLevel: 0,
      wbPreApplied: true,
    },
    provenance: {
      locator: {
        kind: "online-file" as const,
        volume_uuid: "fixture-volume",
        rel_path: "source.png",
      },
      tier: "online-file" as const,
      w: 40,
      h: 30,
      decoderId: "fixture",
      decoderVersion: "1",
    },
  });
  const imageAdapter = new GatewayImageModelAdapter({
    model: "openai/gpt-image-2",
    mask: "native" as const,
    maskPolarity: "transparent-edits" as const,
  });
  const fill = {
    adapter: options.intrinsicDivisor
      ? {
          id: imageAdapter.id,
          version: imageAdapter.version,
          buildEdit: imageAdapter.buildEdit.bind(imageAdapter),
          normalize: async (...args: Parameters<GatewayImageModelAdapter["normalize"]>) => {
            const normalized = await imageAdapter.normalize(...args);
            const w = Math.max(
              1,
              Math.floor(normalized.returnedDimensions.w / options.intrinsicDivisor!),
            );
            const h = Math.max(
              1,
              Math.floor(normalized.returnedDimensions.h / options.intrinsicDivisor!),
            );
            return {
              ...normalized,
              png: await sharp(normalized.png).resize(w, h).png().toBuffer(),
              returnedDimensions: { w, h },
            };
          },
        }
      : imageAdapter,
    gateway,
    model: "openai/gpt-image-2",
    source: sourceProducer,
    upscaleRegistry: registry,
    upscaleSettings: {
      models: { upscale: options.libraryUpscaleModel },
      generation: { upscale: options.generationUpscale ?? ("auto" as const) },
      providers: {
        upscale: {
          "photoctl/fake-upscale-v1": { configured: options.upscaleConfigured ?? true },
        },
      },
    },
    sourceContext: options.sourceContext ?? {
      tier: "online-file",
      pixelScale: 1,
      resolutionLimited: false,
    },
  };
  return {
    parent,
    handle,
    env,
    id: imported.ids[0]!,
    fill,
    sourceProducer,
    generationCalls: () => generationCalls,
    upscaleCalls: () => upscaleCalls,
    replaceUpscaleAdapterVersion: (version: string) => {
      fill.upscaleRegistry = createRegistry(version);
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await handle.close();
      await rm(parent, { recursive: true });
    },
  };
}

export async function fixtureCommand(
  fixture: Awaited<ReturnType<typeof fillUpscaleFixture>>,
  verb: string,
  args: string[],
) {
  return await dispatch(
    { verb, args, cwd: fixture.parent, env: fixture.env },
    { version: "test", library: fixture.handle, fill: fixture.fill },
  );
}

export function success(envelope: Awaited<ReturnType<typeof dispatch>>): unknown {
  expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
  if (!envelope.ok || !("data" in envelope)) throw new Error("Expected data envelope");
  return envelope.data;
}
