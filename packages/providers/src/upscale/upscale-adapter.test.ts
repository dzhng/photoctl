import { expect, test } from "vitest";
import { FakeUpscaleAdapter } from "./fake.js";
import { UpscaleRegistry } from "./registry.js";
import { createHash } from "node:crypto";

test("the registry is only adapter discovery and execution, not policy", () => {
  const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
  const adapter = new FakeUpscaleAdapter();
  registry.register(adapter);

  expect(registry.get(adapter.id)).toBe(adapter);
  expect(registry.get("missing/upscaler")).toBeUndefined();
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

test("a reversible mapped frame reports only its usable sampling dimensions", async () => {
  const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
  const result = await registry.execute(new FakeUpscaleAdapter({ mode: "mapped-frame" }), {
    artifact: artifact(4, 3),
    scale: 2,
  });

  expect(result).toMatchObject({
    ok: true,
    samplingDimensions: { w: 8, h: 6 },
    densitySatisfied: true,
  });
});

test("an invalid frame mapping cannot excuse an aspect change", async () => {
  const registry = new UpscaleRegistry("photoctl/fake-upscale-v1");
  const adapter = new FakeUpscaleAdapter({ mode: "wrong-aspect" });
  const original = adapter.upscale.bind(adapter);
  adapter.upscale = async (input) => ({
    ...(await original(input)),
    frameMapping: {
      source: [0, 0, input.artifact.dimensions.w, input.artifact.dimensions.h],
      output: [0, 0, 8, 7],
    },
  });

  await expect(
    registry.execute(adapter, { artifact: artifact(4, 3), scale: 2 }),
  ).resolves.toMatchObject({
    ok: false,
    code: "upscale_failed",
    message: "Upscaler returned an invalid frame mapping",
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
