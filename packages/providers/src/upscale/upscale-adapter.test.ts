import { expect, test } from "vitest";
import { FakeUpscaleAdapter } from "./fake.js";
import { UpscaleRegistry } from "./registry.js";
import { createHash } from "node:crypto";

test("upscale selection honors command then library then release precedence and explicit consent", () => {
  const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
  registry.register(new FakeUpscaleAdapter({ id: "photoctl/fake-upscale-v1" }));
  registry.register(new FakeUpscaleAdapter({ id: "library/upscale-v2" }));
  registry.register(new FakeUpscaleAdapter({ id: "command/upscale-v3" }));

  const selected = registry.select({
    settings: {
      models: { upscale: "library/upscale-v2" },
      generation: { upscale: "auto" },
      providers: { upscale: { "command/upscale-v3": { configured: true } } },
    },
    modelOverride: "command/upscale-v3",
  });

  expect(selected).toMatchObject({ enabled: true, model: "command/upscale-v3" });
  expect(selected.warnings).toEqual([]);
});

test("auto does not treat ambient credentials as consent for an upscaler", () => {
  const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
  registry.register(new FakeUpscaleAdapter());

  const selected = registry.select({
    settings: { generation: { upscale: "auto" }, providers: { upscale: {} } },
  });

  expect(selected).toMatchObject({
    enabled: false,
    model: "photoctl/fake-upscale-v1",
    warnings: [{ code: "upscale_unconfigured" }],
  });
});

test("the fake adapter proves fixed scales and records adapter-native tiling", async () => {
  const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
  const adapter = new FakeUpscaleAdapter({ nativeTiling: true });
  const result = await registry.execute(adapter, {
    artifact: artifact(4, 3),
    scale: 4,
    fidelity: 0.8,
    creativity: 0.5,
    seed: 19,
  });

  expect(result).toMatchObject({
    ok: true,
    densitySatisfied: true,
    value: {
      dimensions: { w: 16, h: 12 },
      provenance: {
        adapter: "photoctl/fake-upscale-v1",
        model: "photoctl/fake-upscale-v1",
        nativeTiling: { tiles: 4, overlapPx: 32 },
        seed: 19,
      },
    },
  });
  expect(JSON.stringify(result)).not.toMatch(/credential|authorization|signed/i);
});

test("adapter limits return the largest valid fixed scale with a density warning", async () => {
  const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
  const adapter = new FakeUpscaleAdapter({ limits: { maxOutputPixels: 100 } });

  const result = await registry.execute(adapter, { artifact: artifact(4, 3), scale: 4 });

  expect(result).toMatchObject({
    ok: true,
    densitySatisfied: false,
    value: { dimensions: { w: 8, h: 6 } },
    warnings: [{ code: "upscale_resolution_limited" }],
  });
});

test("an unexplained aspect mismatch is rejected at the adapter boundary", async () => {
  const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
  const result = await registry.execute(new FakeUpscaleAdapter({ mode: "wrong-aspect" }), {
    artifact: artifact(4, 3),
    scale: 2,
  });

  expect(result).toMatchObject({
    ok: false,
    code: "upscale_failed",
    message: "Upscaler returned an unexplained aspect ratio change",
  });
});

test("reported upscaler dimensions must match the returned artifact", async () => {
  const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
  const adapter = new FakeUpscaleAdapter();
  const original = adapter.upscale.bind(adapter);
  adapter.upscale = async (input) => {
    const value = await original(input);
    return {
      ...value,
      dimensions: { w: 8, h: 6 },
      artifact: { ...value.artifact, dimensions: { w: 7, h: 6 } },
    };
  };

  const result = await registry.execute(adapter, { artifact: artifact(4, 3), scale: 2 });

  expect(result).toMatchObject({
    ok: false,
    code: "upscale_failed",
    message: "Upscaler dimensions do not match its returned artifact",
  });
});

test("a too-small result is rejected rather than stretched", async () => {
  const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
  const result = await registry.execute(new FakeUpscaleAdapter({ mode: "too-small" }), {
    artifact: artifact(4, 3),
    scale: 2,
  });

  expect(result).toMatchObject({
    ok: false,
    code: "upscale_failed",
    message: "Upscaler returned an image smaller than its input",
  });
});

test("transport failures become a recoverable per-operation result", async () => {
  const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
  const result = await registry.execute(new FakeUpscaleAdapter({ mode: "transport-failure" }), {
    artifact: artifact(4, 3),
    scale: 2,
  });

  expect(result).toMatchObject({
    ok: false,
    code: "upscale_failed",
    message: "Fake upscaler transport failed",
  });
});

test("an input beyond adapter limits fails without attempting generic tiling", async () => {
  const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
  const result = await registry.execute(new FakeUpscaleAdapter({ limits: { maxInputPixels: 4 } }), {
    artifact: artifact(4, 3),
    scale: 2,
  });

  expect(result).toMatchObject({
    ok: false,
    code: "upscale_failed",
    message: "Fake upscaler input exceeds its limit",
  });
});

function artifact(w: number, h: number) {
  const bytes = Buffer.from(`fixture:${w}x${h}`);
  return {
    bytes,
    mediaType: "image/png" as const,
    hash: `a_${createHash("sha256").update(bytes).digest("hex")}` as `a_${string}`,
    dimensions: { w, h },
  };
}
