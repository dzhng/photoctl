/* eslint-disable no-await-in-loop -- Command order is the transform/cache behavior under test. */
import { layerTransformDataSchema, fillMoveDataSchema } from "@photoctl/protocol";
import {
  evaluateGraphNode,
  readArtifactImage,
  readArtifactMask,
  loadActiveDocument,
} from "@photoctl/render";
import { afterEach, describe, expect, test } from "vitest";
import { fillUpscaleFixture, fixtureCommand, success } from "./fill-upscale-fixture.js";
import { dispatch } from "./dispatch.js";

describe.sequential("generated layer density transforms", () => {
  let fixture: Awaited<ReturnType<typeof fillUpscaleFixture>> | undefined;

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  test("generated movement and shrinking use pinned density without reading provider configuration", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const current = fixture;
    const segmented = success(
      await fixtureCommand(current, "segment", [current.id, "--box", "8,8,16,16"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(current, "fill", [
        current.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    await current.handle.query(
      "INSERT INTO settings (key,value) VALUES ('providers',$1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
      [JSON.stringify({ upscale: false })],
    );
    for (const [verb, args] of [
      ["fill", [current.id, "--move", segmented.layer_id, "--by", "1,0"]],
      ["layer", ["transform", current.id, segmented.layer_id, "--scale", "0.5"]],
    ] as const) {
      const response = await dispatch(
        { verb, args: [...args], cwd: current.parent, env: current.env },
        {
          version: "test",
          library: current.handle,
          fill: { ...current.fill, upscaleSettings: undefined },
        },
      );
      expect(response, JSON.stringify(response)).toMatchObject({
        ok: true,
        data: { upscale: { density_satisfied: true } },
      });
    }
    expect(current.upscaleCalls()).toBe(1);
    expect(current.generationCalls()).toBe(1);
    expect((await loadActiveDocument(current.handle, current.id))!.layers).toHaveLength(2);
  });

  test.each(["fill", "layer"])(
    "%s preserves its branch identity and refuses stale activation after settings lookup",
    async (verb) => {
      fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
      const current = fixture;
      const segmented = success(
        await fixtureCommand(current, "segment", [current.id, "--box", "8,8,16,16"]),
      ) as { layer_id: string };
      const fill = [current.id, "--layer", segmented.layer_id, "--remove", "--pad", "0"];
      success(await fixtureCommand(current, "fill", fill));
      await current.handle.query(
        "INSERT INTO settings (key,value) VALUES ('providers',$1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
        [JSON.stringify(current.fill.upscaleSettings.providers)],
      );
      const query = current.handle.query.bind(current.handle);
      let replaced = false;
      let replacement: Awaited<ReturnType<typeof loadActiveDocument>>;
      current.handle.query = async <Row>(sql: string, parameters?: unknown[]) => {
        if (!replaced && sql.includes("SELECT key, value FROM settings")) {
          replaced = true;
          success(
            await fixtureCommand(current, "fill", [
              ...fill,
              "--upscale-model",
              "photoctl/unconfigured-upscale",
            ]),
          );
          replacement = await loadActiveDocument(current.handle, current.id);
        }
        return await query<Row>(sql, parameters);
      };
      try {
        const args =
          verb === "fill"
            ? [current.id, "--move", segmented.layer_id, "--by", "1,0", "--scale", "2"]
            : ["transform", current.id, segmented.layer_id, "--scale", "2"];
        const response = await dispatch(
          { verb, args, cwd: current.parent, env: current.env },
          {
            version: "test",
            library: current.handle,
            fill: { ...current.fill, upscaleSettings: undefined },
          },
        );
        expect(replaced).toBe(true);
        expect(current.upscaleCalls()).toBe(2);
        expect(response, JSON.stringify(response)).toMatchObject({
          ok: false,
          code: "library_locked",
          data: { reason: "revision_conflict" },
        });
        expect(await loadActiveDocument(current.handle, current.id)).toEqual(replacement);
        const retained = await current.handle.query(
          "SELECT attempt.state, artifact.w, artifact.h, execution.execution_id FROM provider_image_attempts attempt JOIN image_artifacts artifact ON artifact.artifact_hash = attempt.original_artifact_hash LEFT JOIN node_executions execution ON execution.provider_image_attempt_id = attempt.id WHERE attempt.request->>'operation' = 'upscale' ORDER BY artifact.w",
        );
        expect(retained.rows).toEqual([
          { state: "committed", w: 32, h: 30, execution_id: expect.any(String) },
          { state: "failed", w: 64, h: 60, execution_id: null },
        ]);
      } finally {
        current.handle.query = query;
      }
    },
  );

  test("combined move and scale commits density and vacancy in the same revision", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "8,8,16,16"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    const before = (await loadActiveDocument(fixture.handle, fixture.id))!;
    expect(fixture.upscaleCalls()).toBe(1);
    const moved = fillMoveDataSchema.parse(
      success(
        await fixtureCommand(fixture, "fill", [
          fixture.id,
          "--move",
          segmented.layer_id,
          "--to",
          "20,15",
          "--scale",
          "2",
        ]),
      ),
    );
    expect(fixture.upscaleCalls()).toBe(2);
    expect(moved).toMatchObject({
      matrix: [2, 0, 0, 2, -12, -17],
      upscale: {
        density_satisfied: true,
        input: { w: 16, h: 15 },
        target: { w: 64, h: 60 },
        generated: { w: 64, h: 60 },
      },
    });
    const after = (await loadActiveDocument(fixture.handle, fixture.id))!;
    expect(
      (
        await fixture.handle.query(
          "SELECT parent_revision_id FROM document_revisions WHERE id = $1",
          [after.revisionId],
        )
      ).rows,
    ).toEqual([{ parent_revision_id: before.revisionId }]);
    expect(after.layers.map(({ id }) => id)).toEqual([moved.vacancy_layer_id, segmented.layer_id]);
    const attempts = await fixture.handle.query(
      "SELECT attempt.state, artifact.w, artifact.h FROM provider_image_attempts attempt JOIN node_executions execution ON execution.provider_image_attempt_id = attempt.id JOIN image_artifacts artifact ON artifact.artifact_hash = attempt.original_artifact_hash WHERE attempt.request->>'operation' = 'upscale' ORDER BY artifact.w",
    );
    expect(attempts.rows).toEqual([
      { state: "committed", w: 32, h: 30 },
      { state: "committed", w: 64, h: 60 },
    ]);
    for (const scale of ["0.25", "4"]) {
      const reused = fillMoveDataSchema.parse(
        success(
          await fixtureCommand(fixture, "fill", [
            fixture.id,
            "--move",
            segmented.layer_id,
            "--by",
            "1,0",
            "--scale",
            scale,
          ]),
        ),
      );
      expect(reused.vacancy_layer_id).toBe(moved.vacancy_layer_id);
      expect(reused.upscale?.density_satisfied).toBe(true);
      expect(fixture.upscaleCalls()).toBe(2);
    }
    expect(fixture.generationCalls()).toBe(1);
  });

  test("a failed combined scale keeps prior pixels and plain moves do not retry it", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "8,8,16,16"]),
    ) as { layer_id: string };
    const filled = success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    ) as { upscale: { node: string } };
    fixture.replaceUpscaleMode("transport-failure");
    const moved = await fixtureCommand(fixture, "fill", [
      fixture.id,
      "--move",
      segmented.layer_id,
      "--to",
      "20,15",
      "--scale",
      "2",
    ]);
    expect(moved).toMatchObject({
      ok: true,
      warnings: [{ code: "upscale_failed" }],
      data: {
        matrix: [2, 0, 0, 2, -12, -17],
        upscale: {
          node: filled.upscale.node,
          density_satisfied: false,
          generated: { w: 32, h: 30 },
        },
      },
    });
    expect(fixture.upscaleCalls()).toBe(2);
    const after = (await loadActiveDocument(fixture.handle, fixture.id))!;
    expect(after.layers.map(({ role }) => role)).toEqual(["vacancy", "subject"]);
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--move",
        segmented.layer_id,
        "--by",
        "1,0",
      ]),
    );
    expect(fixture.upscaleCalls()).toBe(2);
    expect(
      (
        await fixture.handle.query(
          "SELECT count(*)::int AS count FROM image_nodes WHERE kind = 'upscale' AND photo_id = $1",
          [fixture.id],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
  });

  test("a concurrent edit retains combined-scale output without publishing a vacancy or replaying", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const current = fixture;
    const segmented = success(
      await fixtureCommand(current, "segment", [current.id, "--box", "8,8,16,16"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(current, "fill", [
        current.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    const before = (await loadActiveDocument(current.handle, current.id))!;
    const adapter = current.fill.upscaleRegistry.get("photoctl/fake-upscale-v1")!;
    const upscale = adapter.upscale.bind(adapter);
    let concurrentRevision: string | undefined;
    adapter.upscale = async (input) => {
      const result = await upscale(input);
      success(
        await fixtureCommand(current, "layer", [
          "set",
          current.id,
          segmented.layer_id,
          "--opacity",
          "0.5",
        ]),
      );
      concurrentRevision = (await loadActiveDocument(current.handle, current.id))!.revisionId;
      return result;
    };
    const response = await fixtureCommand(current, "fill", [
      current.id,
      "--move",
      segmented.layer_id,
      "--to",
      "20,15",
      "--scale",
      "2",
    ]);
    expect(response).toMatchObject({
      ok: false,
      code: "library_locked",
      data: { reason: "revision_conflict" },
    });
    const after = (await loadActiveDocument(current.handle, current.id))!;
    expect(after.revisionId).toBe(concurrentRevision);
    expect(after.layers).toEqual([{ ...before.layers[0], opacity: 0.5 }]);
    expect(current.upscaleCalls()).toBe(2);
    expect(current.generationCalls()).toBe(1);
    const retained = await current.handle.query(
      "SELECT attempt.state, artifact.w, artifact.h, execution.execution_id FROM provider_image_attempts attempt JOIN image_artifacts artifact ON artifact.artifact_hash = attempt.original_artifact_hash LEFT JOIN node_executions execution ON execution.provider_image_attempt_id = attempt.id WHERE attempt.request->>'operation' = 'upscale' ORDER BY artifact.w",
    );
    expect(retained.rows).toEqual([
      { state: "committed", w: 32, h: 30, execution_id: expect.any(String) },
      { state: "failed", w: 64, h: 60, execution_id: null },
    ]);
  });

  test("combined move refuses border layers without changing outpaint or invoking providers", async () => {
    fixture = await fillUpscaleFixture();
    const outpaint = success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--outpaint",
        "--px",
        "4",
        "--prompt",
        "extend background",
        "--no-upscale",
      ]),
    ) as { graph: { layer: string } };
    const before = await loadActiveDocument(fixture.handle, fixture.id);
    const calls = [fixture.generationCalls(), fixture.upscaleCalls()];
    expect(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--move",
        outpaint.graph.layer,
        "--by",
        "1,0",
        "--scale",
        "2",
      ]),
    ).toMatchObject({ ok: false, code: "usage" });
    expect(await loadActiveDocument(fixture.handle, fixture.id)).toEqual(before);
    expect([fixture.generationCalls(), fixture.upscaleCalls()]).toEqual(calls);
  });

  test("a larger uniform scale runs the smallest sufficient upscale from generation", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "8,8,16,16"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    expect(fixture.upscaleCalls()).toBe(1);

    const transformed = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "2",
        ]),
      ),
    );

    expect(fixture.upscaleCalls()).toBe(2);
    expect(transformed.upscale).toMatchObject({
      enabled: true,
      executed: true,
      density_satisfied: true,
      input: { w: 16, h: 15 },
      target: { w: 64, h: 60 },
      generated: { w: 64, h: 60 },
      final: { w: 64, h: 60 },
    });

    const smaller = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "0.5",
        ]),
      ),
    );
    expect(smaller.upscale).toMatchObject({ density_satisfied: true, target: { w: 16, h: 15 } });
    expect(fixture.upscaleCalls()).toBe(2);

    const reused = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "2",
        ]),
      ),
    );
    expect(reused.upscale).toMatchObject({ density_satisfied: true, generated: { w: 64, h: 60 } });
    expect(fixture.upscaleCalls()).toBe(2);
    const attempts = await fixture.handle.query(
      "SELECT attempt.id, attempt.state, artifact.w, artifact.h FROM provider_image_attempts attempt JOIN node_executions execution ON execution.provider_image_attempt_id = attempt.id JOIN image_artifacts artifact ON artifact.artifact_hash = attempt.original_artifact_hash WHERE attempt.request->>'operation' = 'upscale' ORDER BY artifact.w",
    );
    expect(attempts.rows).toEqual([
      { id: expect.any(String), state: "committed", w: 32, h: 30 },
      { id: expect.any(String), state: "committed", w: 64, h: 60 },
    ]);
  });

  test("auto intent survives a sufficient no-upscale fill for later scaling", async () => {
    fixture = await fillUpscaleFixture();
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
    ) as { layer_id: string };
    const filled = success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    ) as { upscale: { node: string | null } };
    expect(filled.upscale.node).toBeNull();
    expect(fixture.upscaleCalls()).toBe(0);
    const transformed = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "2",
        ]),
      ),
    );
    expect(transformed.upscale).toMatchObject({ executed: true, density_satisfied: true });
    expect(fixture.upscaleCalls()).toBe(1);
  });

  test("an explicit no-upscale refill replaces earlier automatic density intent", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
        "--no-upscale",
      ]),
    );
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(1);

    const transformed = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "2",
        ]),
      ),
    );
    expect(transformed.upscale).toMatchObject({ enabled: false, executed: false });
    expect(fixture.upscaleCalls()).toBe(1);
  });

  test("density growth is relative to scale already baked into generation input", async () => {
    fixture = await fillUpscaleFixture();
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "8,8,16,16"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "layer", [
        "transform",
        fixture.id,
        segmented.layer_id,
        "--scale",
        "0.5",
        "--anchor",
        "0,0",
      ]),
    );
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    expect(fixture.upscaleCalls()).toBe(0);

    const transformed = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "1",
          "--anchor",
          "0,0",
        ]),
      ),
    );
    expect(transformed.upscale).toMatchObject({ executed: true, density_satisfied: true });
    expect(fixture.upscaleCalls()).toBe(1);
  });

  test("an adapter upgrade is paid once and then reuses its exact direct child", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "8,8,16,16"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    fixture.replaceUpscaleAdapterVersion("2");
    success(
      await fixtureCommand(fixture, "layer", [
        "transform",
        fixture.id,
        segmented.layer_id,
        "--scale",
        "2",
      ]),
    );
    expect(fixture.upscaleCalls()).toBe(2);
    success(
      await fixtureCommand(fixture, "layer", [
        "transform",
        fixture.id,
        segmented.layer_id,
        "--scale",
        "2",
      ]),
    );
    expect(fixture.upscaleCalls()).toBe(2);
  });

  test("a limit-bound upscale reports the density planner warning", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "8,8,16,16"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    const response = await fixtureCommand(fixture, "layer", [
      "transform",
      fixture.id,
      segmented.layer_id,
      "--scale",
      "4",
    ]);
    expect(response).toMatchObject({
      ok: true,
      warnings: [{ code: "upscale_resolution_limited" }],
      data: { upscale: { density_satisfied: false } },
    });
  });

  test("move, flip, and quarter rotation reuse pinned pixels without provider availability", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    expect(fixture.upscaleCalls()).toBe(1);
    fixture.fill.upscaleSettings.providers!.upscale!["photoctl/fake-upscale-v1"]!.configured =
      false;
    for (const args of [
      ["--dx", "2"],
      ["--flip", "h"],
      ["--rotate", "90"],
    ]) {
      const result = layerTransformDataSchema.parse(
        success(
          await fixtureCommand(fixture, "layer", [
            "transform",
            fixture.id,
            segmented.layer_id,
            ...args,
          ]),
        ),
      );
      expect(result.upscale).toMatchObject({ executed: true, density_satisfied: true });
    }
    expect(fixture.upscaleCalls()).toBe(1);
    const graph = success(
      await fixtureCommand(fixture, "graph", ["show", fixture.id, "--layer", segmented.layer_id]),
    ) as { nodes: Array<{ kind: string; recipe_version: number }> };
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ kind: "resample", recipe_version: 2 }),
    );
  });

  test("a failed larger upscale still commits the transform with the best prior pixels", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
    ) as { layer_id: string };
    const filled = success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    ) as { upscale: { node: string } };
    fixture.replaceUpscaleMode("transport-failure");
    const response = await fixtureCommand(fixture, "layer", [
      "transform",
      fixture.id,
      segmented.layer_id,
      "--scale",
      "2",
    ]);
    expect(response).toMatchObject({
      ok: true,
      warnings: [{ code: "upscale_failed" }],
      data: {
        upscale: {
          node: filled.upscale.node,
          density_satisfied: false,
          generated: { w: 16, h: 16 },
        },
      },
    });
    expect(fixture.upscaleCalls()).toBe(2);
    const failedRows = await fixture.handle.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM image_nodes WHERE photo_id = $1 AND kind = 'upscale'",
      [fixture.id],
    );
    expect(failedRows.rows[0]!.count).toBe("1");
  });

  test("a layer transformed before fill rebases onto affine placement", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "layer", [
        "transform",
        fixture.id,
        segmented.layer_id,
        "--dx",
        "2",
        "--anchor",
        "0,0",
      ]),
    );
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    const transformed = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "2",
          "--anchor",
          "0,0",
        ]),
      ),
    );
    expect(transformed.matrix).toEqual([2, 0, 0, 2, 0, 0]);
    expect(transformed.upscale).toMatchObject({ density_satisfied: true });
    const graph = success(
      await fixtureCommand(fixture, "graph", ["show", fixture.id, "--layer", segmented.layer_id]),
    ) as { nodes: Array<{ id: string; kind: string; recipe_version: number }> };
    const resample = graph.nodes.find(
      ({ kind, recipe_version }) => kind === "resample" && recipe_version === 2,
    )!;
    const mask = graph.nodes.find(({ kind }) => kind === "transform")!;
    const [resampleEvaluation, maskEvaluation] = await Promise.all([
      evaluateGraphNode({
        database: fixture.handle,
        libraryPath: fixture.handle.path,
        photoId: fixture.id,
        nodeId: resample.id,
        source: fixture.sourceProducer,
      }),
      evaluateGraphNode({
        database: fixture.handle,
        libraryPath: fixture.handle.path,
        photoId: fixture.id,
        nodeId: mask.id,
        source: fixture.sourceProducer,
      }),
    ]);
    const placed = await readArtifactImage(
      resampleEvaluation.artifact.path,
      resampleEvaluation.artifact.artifactHash,
    );
    const transformedMask = await readArtifactMask(
      maskEvaluation.artifact.path,
      maskEvaluation.artifact.artifactHash,
    );
    const placedBounds = nonzeroBounds(placed.data, placed.w, 3);
    const maskBounds = nonzeroBounds(transformedMask.data, transformedMask.w, 1);
    expect(placedBounds.x).toBeLessThanOrEqual(maskBounds.x);
    expect(placedBounds.y).toBeLessThanOrEqual(maskBounds.y);
    expect(placedBounds.x + placedBounds.w).toBeGreaterThanOrEqual(maskBounds.x + maskBounds.w);
    expect(placedBounds.y + placedBounds.h).toBeGreaterThanOrEqual(maskBounds.y + maskBounds.h);
  });
});

function nonzeroBounds(data: ArrayLike<number>, width: number, channels: number) {
  let left = width;
  let top = Number.MAX_SAFE_INTEGER;
  let right = 0;
  let bottom = 0;
  for (let pixel = 0; pixel < data.length / channels; pixel += 1) {
    let nonzero = false;
    for (let channel = 0; channel < channels; channel += 1) {
      if (data[pixel * channels + channel]! > 0) nonzero = true;
    }
    if (!nonzero) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + 1);
    bottom = Math.max(bottom, y + 1);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
