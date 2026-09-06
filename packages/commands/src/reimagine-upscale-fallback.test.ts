import { reimagineDataSchema } from "@photoctl/protocol";
import { loadActiveDocument } from "@photoctl/render";
import { expect, test } from "vitest";
import { fillUpscaleFixture, fixtureCommand, success } from "./fill-upscale-fixture.js";

test("full-frame upscale-only refresh preserves generation and retains the last successful upscale on failure", async () => {
  const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
  try {
    const edit = reimagineDataSchema.parse(
      success(await fixtureCommand(fixture, "reimagine", [fixture.id, "--prompt", "twilight"])),
    );
    const refresh = success(
      await fixtureCommand(fixture, "layer", [
        "refresh",
        fixture.id,
        edit.layer_id,
        "--from",
        edit.upscale.node!,
      ]),
    ) as { upscale: { node: string }; executions: unknown[]; render_hash: string };
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(2);
    expect(refresh.upscale.node).not.toBe(edit.upscale.node);
    expect(refresh.executions).toMatchObject([
      { kind: "generate", node: edit.generation.node, reused: true },
      { kind: "upscale", reused: false },
    ]);
    const beforeFailure = await loadActiveDocument(fixture.handle, fixture.id);
    fixture.replaceUpscaleMode("transport-failure");
    const failed = success(
      await fixtureCommand(fixture, "layer", [
        "refresh",
        fixture.id,
        edit.layer_id,
        "--from",
        refresh.upscale.node,
      ]),
    ) as { render_hash: string; upscale: { node: string }; executions: unknown[] };
    expect((await loadActiveDocument(fixture.handle, fixture.id))!.roots.output).toBe(
      beforeFailure!.roots.output,
    );
    expect(failed.upscale.node).toBe(refresh.upscale.node);
    expect(failed.upscale).toMatchObject({ executed: true, density_satisfied: true });
    expect(failed.executions).toMatchObject([
      { kind: "generate", reused: true },
      { kind: "upscale", reused: true },
    ]);
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(3);
  } finally {
    await fixture.close();
  }
});

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
    const attempt = await fixture.handle.query<{ id: string }>(
      "SELECT id FROM provider_image_attempts WHERE request->>'operation' = 'upscale'",
    );
    expect(attempt.rows).toEqual([{ id: expect.any(String) }]);
    expect(result.upscale.warnings).toEqual([
      {
        code: "upscale_failed",
        message: `Fake upscaler transport failed (attempt ${attempt.rows[0]!.id})`,
        attempt_id: attempt.rows[0]!.id,
      },
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

test("reimagine accepts a reduced pinned source and targets the authored viewport density", async () => {
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

    const created = await fixtureCommand(fixture, "reimagine", [
      fixture.id,
      "--prompt",
      "painted twilight",
    ]);
    expect(created).toMatchObject({
      ok: true,
      data: {
        source_context: { tier: "pinned-preview", pixel_scale: 0.5, resolution_limited: true },
        generation: { returned: { w: 20, h: 15 } },
        upscale: { target: { w: 40, h: 30 } },
      },
    });
    const after = success(await fixtureCommand(fixture, "show", [fixture.id])) as {
      render_hash: string;
    };
    expect(after.render_hash).not.toBe(before.render_hash);
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(1);
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
