import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fillUpscaleFixture, fixtureCommand, success } from "./fill-upscale-fixture.js";

test("relight validates every required control before provider work or revision change", async () => {
  const fixture = await fillUpscaleFixture({ generationUpscale: "off" });
  try {
    const before = success(await fixtureCommand(fixture, "show", [fixture.id])) as {
      revision_id: string;
    };
    for (const args of [
      [fixture.id, "--elevation", "45", "--intensity", "0.5"],
      [fixture.id, "--azimuth", "361", "--elevation", "45", "--intensity", "0.5"],
      [fixture.id, "--azimuth", "35", "--elevation", "-91", "--intensity", "0.5"],
      [fixture.id, "--azimuth", "35", "--elevation", "45", "--intensity", "1.1"],
    ]) {
      expect(await fixtureCommand(fixture, "relight", args)).toMatchObject({
        ok: false,
        code: "usage",
      });
    }
    const after = success(await fixtureCommand(fixture, "show", [fixture.id])) as {
      revision_id: string;
    };
    expect(after.revision_id).toBe(before.revision_id);
    expect(fixture.generationCalls()).toBe(0);
    expect(fixture.upscaleCalls()).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("relight preserves the exact-base refusal before provider work or revision change", async () => {
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
    const beforeLayers = success(await fixtureCommand(fixture, "layer", ["list", fixture.id])) as {
      revision_id: string;
    };

    const refused = await fixtureCommand(fixture, "relight", [
      fixture.id,
      "--azimuth",
      "35",
      "--elevation",
      "60",
      "--intensity",
      "0.75",
    ]);
    expect(refused).toMatchObject({ ok: false, code: "usage" });
    const after = success(await fixtureCommand(fixture, "show", [fixture.id])) as {
      render_hash: string;
    };
    const afterLayers = success(await fixtureCommand(fixture, "layer", ["list", fixture.id])) as {
      revision_id: string;
    };
    expect(after.render_hash).toBe(before.render_hash);
    expect(afterLayers.revision_id).toBe(beforeLayers.revision_id);
    expect(fixture.generationCalls()).toBe(0);
    expect(fixture.upscaleCalls()).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("relight refuses crop and rotation geometry before provider work", async () => {
  const fixture = await fillUpscaleFixture();
  try {
    const developed = await fixtureCommand(fixture, "develop", [
      fixture.id,
      "--set",
      'crop={"x":5,"y":5,"w":20,"h":10}',
      "rotate=90",
    ]);
    expect(developed, JSON.stringify(developed)).toMatchObject({ ok: true });
    const before = success(await fixtureCommand(fixture, "layer", ["list", fixture.id])) as {
      revision_id: string;
      render_hash: string;
    };

    expect(
      await fixtureCommand(fixture, "relight", [
        fixture.id,
        "--azimuth",
        "35",
        "--elevation",
        "60",
        "--intensity",
        "0.75",
      ]),
    ).toMatchObject({ ok: false, code: "usage" });
    const after = success(await fixtureCommand(fixture, "layer", ["list", fixture.id])) as {
      revision_id: string;
      render_hash: string;
    };
    expect(after).toMatchObject(before);
    expect(fixture.generationCalls()).toBe(0);
    expect(fixture.upscaleCalls()).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("relight leaves the active revision unchanged when provider geometry is invalid", async () => {
  const fixture = await fillUpscaleFixture({ generationUpscale: "off" });
  try {
    const before = success(await fixtureCommand(fixture, "show", [fixture.id])) as {
      render_hash: string;
    };
    const beforeLayers = success(await fixtureCommand(fixture, "layer", ["list", fixture.id])) as {
      revision_id: string;
    };
    fixture.replaceGenerationMode("wrongaspect");

    const refused = await fixtureCommand(fixture, "relight", [
      fixture.id,
      "--azimuth",
      "35",
      "--elevation",
      "60",
      "--intensity",
      "0.75",
    ]);
    expect(refused).toMatchObject({ ok: false, code: "provider_whole_frame" });
    const after = success(await fixtureCommand(fixture, "show", [fixture.id])) as {
      render_hash: string;
    };
    const afterLayers = success(await fixtureCommand(fixture, "layer", ["list", fixture.id])) as {
      revision_id: string;
    };
    expect(after.render_hash).toBe(before.render_hash);
    expect(afterLayers.revision_id).toBe(beforeLayers.revision_id);
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("zero intensity keeps current pixels while retaining a removable relight revision", async () => {
  const fixture = await fillUpscaleFixture({ generationUpscale: "off" });
  try {
    const before = success(await fixtureCommand(fixture, "show", [fixture.id])) as {
      preview: string;
      render_hash: string;
    };
    const relighted = success(
      await fixtureCommand(fixture, "relight", [
        fixture.id,
        "--azimuth",
        "35",
        "--elevation",
        "60",
        "--intensity",
        "0",
      ]),
    ) as { layer_id: string; render_hash: string };
    expect(relighted.render_hash).not.toBe(before.render_hash);
    const after = success(await fixtureCommand(fixture, "show", [fixture.id])) as {
      preview: string;
    };
    expect(await readFile(after.preview)).toEqual(await readFile(before.preview));
    expect(fixture.generationCalls()).toBe(1);
    const removed = success(
      await fixtureCommand(fixture, "layer", ["remove", fixture.id, relighted.layer_id]),
    ) as { render_hash: string };
    expect(removed.render_hash).toBe(before.render_hash);
  } finally {
    await fixture.close();
  }
});
