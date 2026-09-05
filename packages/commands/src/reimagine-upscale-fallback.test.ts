import { reimagineDataSchema } from "@photoctl/protocol";
import { expect, test } from "vitest";
import { fillUpscaleFixture, fixtureCommand, success } from "./fill-upscale-fixture.js";

test("reimagine keeps successful generation active when density matching fails", async () => {
  const fixture = await fillUpscaleFixture({
    generationMode: "smallerdims",
    upscaleMode: "transport-failure",
  });
  try {
    const result = reimagineDataSchema.parse(
      success(
        await fixtureCommand(fixture, "reimagine", [fixture.id, "--prompt", "painted twilight"]),
      ),
    );

    expect(result).toMatchObject({
      drift: "full-frame",
      upscale: { executed: false, node: null, density_satisfied: false },
      executions: [{ kind: "generate" }],
    });
    expect(result.upscale.warnings).toEqual([
      { code: "upscale_failed", message: "Fake upscaler transport failed" },
    ]);
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(1);
    const layers = success(await fixtureCommand(fixture, "layer", ["list", fixture.id])) as {
      revision_id: string;
      layers: Array<{ id: string; role: string }>;
    };
    expect(layers).toMatchObject({
      revision_id: result.revision_id,
      layers: [{ id: result.layer_id, role: "reimagine" }],
    });
  } finally {
    await fixture.close();
  }
});

test("reimagine leaves the active revision unchanged when generation geometry is invalid", async () => {
  const fixture = await fillUpscaleFixture({ generationUpscale: "off" });
  try {
    const before = success(await fixtureCommand(fixture, "show", [fixture.id])) as {
      render_hash: string;
    };
    fixture.replaceGenerationMode("wrongaspect");
    const invalid = await fixtureCommand(fixture, "reimagine", [
      fixture.id,
      "--prompt",
      "painted twilight",
    ]);

    expect(invalid).toMatchObject({ ok: false, code: "provider_whole_frame" });
    const after = success(await fixtureCommand(fixture, "show", [fixture.id])) as {
      render_hash: string;
    };
    expect(after.render_hash).toBe(before.render_hash);
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("reimagine refuses a low-resolution base before provider work or revision change", async () => {
  const fixture = await fillUpscaleFixture();
  try {
    fixture.fill.source = async () => ({
      image: {
        w: 20,
        h: 15,
        data: new Float32Array(20 * 15 * 3).fill(0.25),
        orientationApplied: true as const,
        space: "scene-linear-rec2020" as const,
        whiteLevel: 1,
        blackLevel: 0,
        wbPreApplied: true,
      },
      provenance: {
        locator: { kind: "pinned-preview" as const, cache_path: `emb/${fixture.id}.jpg` },
        tier: "pinned-preview" as const,
        w: 20,
        h: 15,
        decoderId: "fixture",
        decoderVersion: "1",
      },
    });
    fixture.fill.sourceContext = {
      tier: "pinned-preview",
      pixelScale: 0.5,
      resolutionLimited: true,
    };
    const before = success(await fixtureCommand(fixture, "show", [fixture.id])) as {
      render_hash: string;
    };

    const refused = await fixtureCommand(fixture, "reimagine", [
      fixture.id,
      "--prompt",
      "painted twilight",
    ]);
    expect(refused).toMatchObject({ ok: false, code: "usage" });
    const after = success(await fixtureCommand(fixture, "show", [fixture.id])) as {
      render_hash: string;
    };
    expect(after.render_hash).toBe(before.render_hash);
    expect(fixture.generationCalls()).toBe(0);
    expect(fixture.upscaleCalls()).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("progress delivery failure cannot override a committed reimagine", async () => {
  const fixture = await fillUpscaleFixture({ generationUpscale: "off" });
  try {
    const result = reimagineDataSchema.parse(
      success(
        await fixtureCommand(
          fixture,
          "reimagine",
          [fixture.id, "--prompt", "painted twilight"],
          async () => {
            throw new Error("progress channel closed");
          },
        ),
      ),
    );
    expect(fixture.generationCalls()).toBe(1);
    const layers = success(await fixtureCommand(fixture, "layer", ["list", fixture.id])) as {
      revision_id: string;
      layers: Array<{ id: string }>;
    };
    expect(layers).toMatchObject({
      revision_id: result.revision_id,
      layers: [{ id: result.layer_id }],
    });
  } finally {
    await fixture.close();
  }
});
