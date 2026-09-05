import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, expect, test } from "vitest";
import { runWorkbench } from "./run.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { FakeUpscaleAdapter, UpscaleRegistry, type UpscaleInput } from "@photoctl/providers";

const directories: string[] = [];
class ObservedAdapter extends FakeUpscaleAdapter {
  inputs: UpscaleInput[] = [];
  override async upscale(input: UpscaleInput) {
    this.inputs.push(input);
    return await super.upscale(input);
  }
}
class PatternedAdapter extends ObservedAdapter {
  override async upscale(input: UpscaleInput) {
    const result = await super.upscale(input);
    const bytes = await sharp(input.artifact.bytes)
      .resize({ width: result.dimensions.w, height: result.dimensions.h, kernel: "nearest" })
      .png()
      .toBuffer();
    return {
      ...result,
      artifact: {
        ...result.artifact,
        bytes,
        hash: `a_${createHash("sha256").update(bytes).digest("hex")}` as const,
      },
      provenance: {
        ...result.provenance,
        requestId: `request-${this.inputs.length}`,
        costUsd: 0.02,
      },
    };
  }
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("different provider output dimensions are not reported as measured pixel drift", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-upscale-drift-"));
  directories.push(cwd);
  await sharp({ create: { width: 8, height: 6, channels: 3, background: "#936" } })
    .png()
    .toFile(join(cwd, "source.png"));
  await writeFile(
    join(cwd, "experiment.json"),
    JSON.stringify({
      model: "photoctl/fake-upscale-v1",
      controls: {
        scale: 4,
        fidelity: 0.7,
        creativity: 0.3,
        seed: 42,
        originalOperation: "denoise",
      },
      controlStrength: { variable: "fidelity", values: [0.7, 0.9] },
      sources: [{ path: "source.png" }],
    }),
  );
  class VariableSizeAdapter extends FakeUpscaleAdapter {
    override async upscale(input: UpscaleInput) {
      return await super.upscale({
        ...input,
        scale: input.prompt?.startsWith("Preserve the source") ? 2 : 4,
      });
    }
  }
  const adapter = new VariableSizeAdapter();
  const registry = new UpscaleRegistry(adapter.id);
  registry.register(adapter);
  const output = await runWorkbench(
    ["upscale-spike", "--config", "experiment.json"],
    cwd,
    {},
    { upscaleRegistry: registry },
  );
  const evidence = JSON.parse(await readFile(output, "utf8"));
  expect(evidence.comparisons[0].guarded.dimensions).toEqual({ w: 32, h: 24 });
  expect(evidence.comparisons[0].minimal.dimensions).toEqual({ w: 16, h: 12 });
  expect(evidence.comparisons[0].drift).toEqual({
    meanAbsoluteError: null,
    reason: "different_output_dimensions",
  });
});

test("identical source requests share a provider result across distinct inspection crops and categories", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-upscale-reuse-"));
  directories.push(cwd);
  const pixels = Buffer.alloc(40 * 30 * 3);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 40; x++) {
      pixels.set([x * 6, y * 8, 100], (y * 40 + x) * 3);
    }
  const source = await sharp(pixels, { raw: { width: 40, height: 30, channels: 3 } })
    .png()
    .toBuffer();
  await writeFile(join(cwd, "first.png"), source);
  await writeFile(join(cwd, "second.png"), source);
  const crops = [
    [3, 5, 7, 9],
    [17, 11, 9, 7],
  ];
  await writeFile(
    join(cwd, "experiment.json"),
    JSON.stringify({
      model: "photoctl/fake-upscale-v1",
      controls: {
        scale: 2,
        fidelity: 0.7,
        creativity: 0.3,
        seed: 42,
        originalOperation: "denoise",
      },
      controlStrength: { variable: "fidelity", values: [0.7, 0.9] },
      sources: [
        { path: "first.png", category: "face-hair", crop: crops[0] },
        { path: "second.png", category: "fabric-foliage", crop: crops[1] },
      ],
    }),
  );
  const adapter = new PatternedAdapter();
  const registry = new UpscaleRegistry(adapter.id);
  registry.register(adapter);
  const output = await runWorkbench(
    ["upscale-spike", "--config", "experiment.json"],
    cwd,
    {},
    { upscaleRegistry: registry },
  );
  const evidence = JSON.parse(await readFile(output, "utf8"));
  const [first, second] = evidence.comparisons;
  expect(evidence.providerRequests).toBe(3);
  expect(evidence.providerCostUsd).toBeCloseTo(0.06);
  expect(adapter.inputs.map(({ prompt, fidelity }) => ({ prompt, fidelity }))).toEqual([
    { prompt: first.guarded.prompt, fidelity: 0.7 },
    { prompt: first.minimal.prompt, fidelity: 0.7 },
    { prompt: first.guarded.prompt, fidelity: 0.9 },
  ]);
  expect(second.guarded.requestId).toBe(first.guarded.requestId);
  expect(second.guarded.output).toBe(first.guarded.output);
  expect(second.guarded.detail).not.toBe(first.guarded.detail);
  expect(second.strength.map((arm: { requestId: string }) => arm.requestId)).toEqual(
    first.strength.map((arm: { requestId: string }) => arm.requestId),
  );
  const details = await Promise.all(
    evidence.comparisons.map(async (comparison: typeof first, index: number) => {
      const [left, top, width, height] = crops[index]!;
      const expected = await sharp(source)
        .extract({ left: left!, top: top!, width: width!, height: height! })
        .resize({ width: width! * 2, height: height! * 2, kernel: "nearest" })
        .raw()
        .toBuffer();
      const actual = await sharp(join(cwd, "out/wb", comparison.guarded.detail))
        .raw()
        .toBuffer();
      expect(actual.equals(expected)).toBe(true);
      return actual;
    }),
  );
  expect(details[0]!.equals(details[1]!)).toBe(false);

  const changed = await sharp(source).negate().png().toBuffer();
  await writeFile(join(cwd, "second.png"), changed);
  const rerun = JSON.parse(
    await readFile(
      await runWorkbench(
        ["upscale-spike", "--config", "experiment.json"],
        cwd,
        {},
        { upscaleRegistry: registry },
      ),
      "utf8",
    ),
  );
  const hashes = [source, changed].map(
    (bytes) => `a_${createHash("sha256").update(bytes).digest("hex")}`,
  );
  expect(adapter.inputs.slice(3).map(({ artifact }) => artifact.hash)).toEqual([
    hashes[0],
    hashes[0],
    hashes[0],
    hashes[1],
    hashes[1],
    hashes[1],
  ]);
  expect(rerun.comparisons[0].guarded.requestIdentity).toBe(first.guarded.requestIdentity);
  expect(rerun.comparisons[0].guarded.requestId).not.toBe(first.guarded.requestId);
  expect(rerun.comparisons[1].guarded.requestIdentity).not.toBe(
    rerun.comparisons[0].guarded.requestIdentity,
  );
});

test("built CLI retains mask context and all declared validation categories", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-upscale-built-"));
  directories.push(cwd);
  await sharp({ create: { width: 48, height: 32, channels: 3, background: "#395" } })
    .png()
    .toFile(join(cwd, "source.png"));
  await sharp({ create: { width: 48, height: 32, channels: 3, background: "#fff" } })
    .png()
    .toFile(join(cwd, "mask.png"));
  const categories = ["face-hair", "fabric-foliage", "architecture", "text-logo", "mask-texture"];
  await writeFile(
    join(cwd, "experiment.json"),
    JSON.stringify({
      model: "photoctl/fake-upscale-v1",
      controls: {
        scale: 2,
        fidelity: 0.7,
        creativity: 0.3,
        seed: 9,
        originalOperation: "restore texture",
      },
      controlStrength: { variable: "creativity", values: [0.1, 0.6] },
      sources: categories.map((category) => ({
        path: "source.png",
        category,
        crop: [5, 7, 12, 10],
        ...(category === "mask-texture" ? { mask: "mask.png" } : {}),
      })),
    }),
  );
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      join(process.cwd(), "apps/workbench/dist/cli.js"),
      "upscale-spike",
      "--config",
      "experiment.json",
    ],
    { cwd, env: { ...process.env, AI_GATEWAY_API_KEY: "not-consent" } },
  );
  const evidence = JSON.parse(await readFile(stdout.trim(), "utf8"));
  expect(evidence.categoryCoverage).toEqual({ present: categories, missing: [] });
  expect(
    evidence.sheets
      .filter((sheet: { kind: string }) => sheet.kind === "validation")
      .map((sheet: { category: string }) => sheet.category),
  ).toEqual(categories);
  const mask = evidence.comparisons[4].mask;
  expect(mask.role).toContain("not sent to upscaler");
  expect(
    (await readFile(join(cwd, "out/wb", mask.path))).equals(await readFile(join(cwd, "mask.png"))),
  ).toBe(true);
  expect(evidence.releaseDecision).toBe("deferred");
});

test.each(["crop", "corrupt", "input-limit", "output-limit"])(
  "a bad later source (%s) is rejected before the first adapter call",
  async (failure) => {
    const cwd = await mkdtemp(join(tmpdir(), "photoctl-upscale-preflight-"));
    directories.push(cwd);
    await sharp({ create: { width: 30, height: 20, channels: 3, background: "#936" } })
      .png()
      .toFile(join(cwd, "source.png"));
    const larger = await sharp({
      create: { width: 60, height: 40, channels: 3, background: "#369" },
    })
      .png()
      .toBuffer();
    await writeFile(join(cwd, "larger.png"), larger);
    if (failure === "corrupt") {
      const raw = Buffer.alloc(192 * 128 * 3);
      for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + Math.floor(i / 17)) % 256;
      const png = await sharp(raw, { raw: { width: 192, height: 128, channels: 3 } })
        .png()
        .toBuffer();
      await writeFile(join(cwd, "larger.png"), png.subarray(0, Math.floor(png.length / 2)));
    }
    await writeFile(
      join(cwd, "experiment.json"),
      JSON.stringify({
        model: "photoctl/fake-upscale-v1",
        controls: {
          scale: 2,
          fidelity: 0.7,
          creativity: 0.3,
          seed: 42,
          originalOperation: "denoise",
        },
        controlStrength: { variable: "fidelity", values: [0.5, 0.9] },
        sources: [
          { path: "source.png" },
          failure === "crop" ? { path: "source.png", crop: [29, 0, 2, 2] } : { path: "larger.png" },
        ],
      }),
    );
    const adapter = new ObservedAdapter({
      limits:
        failure === "input-limit"
          ? { maxInputPixels: 1000 }
          : failure === "output-limit"
            ? { maxOutputEdge: 100 }
            : {},
    });
    const registry = new UpscaleRegistry(adapter.id);
    registry.register(adapter);
    await expect(
      runWorkbench(
        ["upscale-spike", "--config", "experiment.json"],
        cwd,
        {},
        { upscaleRegistry: registry },
      ),
    ).rejects.toThrow();
    expect(adapter.inputs).toEqual([]);
  },
);

test("invalid manifests replace stale completed evidence before any experiment can be mistaken for the new run", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-upscale-invalid-"));
  directories.push(cwd);
  await mkdir(join(cwd, "out/wb"), { recursive: true });
  await writeFile(join(cwd, "out/wb/upscale-spike.json"), JSON.stringify({ status: "completed" }));
  await writeFile(
    join(cwd, "invalid.json"),
    JSON.stringify({ model: "photoctl/fake-upscale-v1", controls: null }),
  );
  await expect(runWorkbench(["upscale-spike", "--config", "invalid.json"], cwd)).rejects.toThrow(
    "Invalid upscale-spike manifest",
  );
  expect(JSON.parse(await readFile(join(cwd, "out/wb/upscale-spike.json"), "utf8"))).toMatchObject({
    status: "failed",
    releaseDecision: "deferred",
  });
});

test("manifest separates prompt, one-control, and validation evidence without claiming live quality", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-upscale-controls-"));
  directories.push(cwd);
  await sharp({ create: { width: 80, height: 60, channels: 3, background: "#936" } })
    .png()
    .toFile(join(cwd, "source.png"));
  await writeFile(
    join(cwd, "experiment.json"),
    JSON.stringify({
      model: "photoctl/fake-upscale-v1",
      controls: {
        scale: 2,
        fidelity: 0.7,
        creativity: 0.3,
        seed: 42,
        originalOperation: "denoise",
      },
      controlStrength: { variable: "fidelity", values: [0.5, 0.9] },
      sources: [{ path: "source.png", category: "face-hair", crop: [10, 12, 20, 24] }],
    }),
  );
  const adapter = new ObservedAdapter();
  const registry = new UpscaleRegistry(adapter.id);
  registry.register(adapter);
  const output = await runWorkbench(
    ["upscale-spike", "--config", "experiment.json"],
    cwd,
    {},
    { upscaleRegistry: registry },
  );
  const evidence = JSON.parse(await readFile(output, "utf8"));
  expect(evidence).toMatchObject({
    status: "completed",
    releaseDecision: "deferred",
    qualityAcceptance: "not_recorded",
    categoryCoverage: {
      present: ["face-hair"],
      missing: ["fabric-foliage", "architecture", "text-logo", "mask-texture"],
    },
  });
  const comparison = evidence.comparisons[0];
  expect(comparison).toMatchObject({
    source: "source.png",
    crop: [10, 12, 20, 24],
    sourceDimensions: { w: 80, h: 60 },
  });
  expect(comparison.guarded.prompt).not.toBe(comparison.minimal.prompt);
  expect(comparison.drift.meanAbsoluteError).toBeGreaterThan(0);
  expect(comparison.guarded.requestedControls).toEqual(comparison.minimal.requestedControls);
  expect(
    comparison.strength.map((arm: { requestedControls: unknown }) => arm.requestedControls),
  ).toEqual([
    { scale: 2, fidelity: 0.5, creativity: 0.3, seed: 42 },
    { scale: 2, fidelity: 0.9, creativity: 0.3, seed: 42 },
  ]);
  await Promise.all(
    [comparison.guarded, comparison.minimal, ...comparison.strength].map(async (arm, index) => {
      expect(arm).toMatchObject({
        sourceHash: comparison.sourceHash,
        targetDimensions: { w: 160, h: 120 },
        provenance: { service: "fake", adapterVersion: "1", modelVersion: "1" },
      });
      expect(arm.resolvedControls).toBeNull();
      expect(arm.latencyMs).toBeGreaterThanOrEqual(0);
      expect(adapter.inputs[index]).toMatchObject({
        ...arm.requestedControls,
        prompt: arm.prompt,
        artifact: { hash: comparison.sourceHash },
      });
      expect(
        adapter.inputs[index]!.artifact.bytes.equals(await readFile(join(cwd, "source.png"))),
      ).toBe(true);
      expect(await sharp(join(cwd, "out/wb", arm.detail)).metadata()).toMatchObject({
        width: 40,
        height: 48,
      });
    }),
  );
  expect(comparison.strength.map((arm: { prompt: string }) => arm.prompt)).toEqual([
    comparison.guarded.prompt,
    comparison.guarded.prompt,
  ]);
  expect(evidence.sheets.map((sheet: { kind: string }) => sheet.kind)).toEqual([
    "prompt",
    "control",
    "validation",
  ]);
  await Promise.all(
    evidence.sheets.map(async (sheet: { path: string }) => {
      expect(await sharp(join(cwd, "out/wb", sheet.path)).metadata()).toMatchObject({
        format: "png",
      });
    }),
  );
});

test("large native crops stay available without expanding the sheet, and baseline strength reuses its request", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-upscale-large-"));
  directories.push(cwd);
  await sharp({ create: { width: 300, height: 300, channels: 3, background: "#936" } })
    .png()
    .toFile(join(cwd, "source.png"));
  await writeFile(
    join(cwd, "experiment.json"),
    JSON.stringify({
      model: "photoctl/fake-upscale-v1",
      controls: {
        scale: 4,
        fidelity: 0.7,
        creativity: 0.3,
        seed: 42,
        originalOperation: "denoise",
      },
      controlStrength: { variable: "fidelity", values: [0.7, 0.9] },
      sources: [{ path: "source.png", crop: [0, 0, 300, 300] }],
    }),
  );
  const adapter = new ObservedAdapter();
  const registry = new UpscaleRegistry(adapter.id);
  registry.register(adapter);
  const output = await runWorkbench(
    ["upscale-spike", "--config", "experiment.json"],
    cwd,
    {},
    { upscaleRegistry: registry },
  );
  const evidence = JSON.parse(await readFile(output, "utf8"));
  const comparison = evidence.comparisons[0];
  expect(await sharp(join(cwd, "out/wb", comparison.guarded.detail)).metadata()).toMatchObject({
    width: 1200,
    height: 1200,
  });
  const sheet = await sharp(join(cwd, "out/wb", evidence.sheets[0].path)).metadata();
  expect(sheet.width).toBeLessThanOrEqual(988);
  expect(sheet.height).toBeLessThanOrEqual(1278);
  expect(adapter.inputs.map(({ prompt, fidelity }) => ({ prompt, fidelity }))).toEqual([
    { prompt: comparison.guarded.prompt, fidelity: 0.7 },
    { prompt: comparison.minimal.prompt, fidelity: 0.7 },
    { prompt: comparison.guarded.prompt, fidelity: 0.9 },
  ]);
  expect(comparison.strength[0]).toMatchObject({
    requestId: comparison.guarded.requestId,
    requestIdentity: comparison.guarded.requestIdentity,
    output: comparison.guarded.output,
    provenance: comparison.guarded.provenance,
  });
});
