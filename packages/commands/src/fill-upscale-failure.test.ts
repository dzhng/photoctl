import { fillStrictDataSchema } from "@photoctl/protocol";
import { describe, expect, test } from "vitest";
import { fillUpscaleFixture, fixtureCommand, success } from "./fill-upscale-fixture.js";

describe.sequential("fill upscale failure retention", () => {
  test("upscale capture persistence failure aborts the fill without discarding its earlier paid original", async () => {
    const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const before = await fixture.handle.query(
        "SELECT active_revision_id FROM photo_documents WHERE photo_id = $1",
        [fixture.id],
      );
      await fixture.handle.query(
        "CREATE FUNCTION fail_upscale_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state = 'retained' AND NEW.request->>'operation' = 'upscale' THEN RAISE EXCEPTION 'forced upscale retention failure'; END IF; RETURN NEW; END $$",
      );
      await fixture.handle.query(
        "CREATE TRIGGER fail_upscale_capture BEFORE UPDATE ON provider_image_attempts FOR EACH ROW EXECUTE FUNCTION fail_upscale_capture()",
      );
      const response = await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]);
      expect(response).toMatchObject({
        ok: false,
        code: "catalog_unreadable",
        data: { attempt_id: expect.any(String), retention_failed: true },
      });
      const attempts = await fixture.handle.query(
        "SELECT request->>'operation' AS operation, state, original_artifact_hash FROM provider_image_attempts ORDER BY created_at",
      );
      expect(attempts.rows).toEqual([
        {
          operation: "edit",
          state: "failed",
          original_artifact_hash: expect.stringMatching(/^a_[a-f0-9]{64}$/),
        },
        { operation: "upscale", state: "failed", original_artifact_hash: null },
      ]);
      expect(
        (
          await fixture.handle.query(
            "SELECT active_revision_id FROM photo_documents WHERE photo_id = $1",
            [fixture.id],
          )
        ).rows,
      ).toEqual(before.rows);
      expect(fixture.generationCalls()).toBe(1);
      expect(fixture.upscaleCalls()).toBe(1);
    } finally {
      await fixture.close();
    }
  });
  for (const mode of ["transport-failure", "wrong-aspect", "too-small", "corrupt"] as const) {
    test(`${mode} keeps generation active without publishing an upscale node`, async () => {
      const fixture = await fillUpscaleFixture({
        generationMode: "smallerdims",
        upscaleMode: mode,
      });
      try {
        const segmented = success(
          await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
        ) as { layer_id: string };
        const args = [fixture.id, "--layer", segmented.layer_id, "--remove", "--pad", "0"];
        const first = fillStrictDataSchema.parse(
          success(await fixtureCommand(fixture, "fill", args)),
        );
        expect(first.upscale).toMatchObject({
          enabled: true,
          executed: false,
          node: null,
          density_satisfied: false,
          warnings: [{ code: "upscale_failed" }],
        });
        expect(first.executions.map(({ kind }) => kind)).toEqual(["generate"]);
        const attempts = await fixture.handle.query<{
          id: string;
          state: string;
          original_artifact_hash: string | null;
        }>(
          "SELECT id, state, original_artifact_hash FROM provider_image_attempts WHERE request->>'operation' = 'upscale'",
        );
        expect(attempts.rows).toEqual([
          {
            id: expect.any(String),
            state: mode === "wrong-aspect" || mode === "too-small" ? "rejected" : "failed",
            original_artifact_hash:
              mode === "wrong-aspect" || mode === "too-small"
                ? expect.stringMatching(/^a_[a-f0-9]{64}$/)
                : null,
          },
        ]);
        expect(first.upscale.warnings).toContainEqual(
          expect.objectContaining({ code: "upscale_failed", attempt_id: attempts.rows[0]!.id }),
        );
        const graph = success(await fixtureCommand(fixture, "graph", ["show", fixture.id])) as {
          nodes: Array<{ kind: string }>;
        };
        expect(graph.nodes.filter(({ kind }) => kind === "upscale")).toHaveLength(0);

        if (mode === "transport-failure") {
          const retried = fillStrictDataSchema.parse(
            success(await fixtureCommand(fixture, "fill", args)),
          );
          expect(retried.generation.node).toBe(first.generation.node);
          expect(fixture.generationCalls()).toBe(1);
          expect(fixture.upscaleCalls()).toBe(2);
        }
      } finally {
        await fixture.close();
      }
    });
  }

  test("retry reports the source context pinned to the reused generation", async () => {
    const fixture = await fillUpscaleFixture({
      generationMode: "smallerdims",
      upscaleMode: "transport-failure",
      sourceContext: { tier: "pinned-preview", pixelScale: 0.5, resolutionLimited: true },
    });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const args = [fixture.id, "--layer", segmented.layer_id, "--remove", "--pad", "0"];
      await fixtureCommand(fixture, "fill", args);
      fixture.fill.sourceContext = {
        tier: "online-file",
        pixelScale: 1,
        resolutionLimited: false,
      };

      const retryEnvelope = await fixtureCommand(fixture, "fill", args);
      const retried = fillStrictDataSchema.parse(success(retryEnvelope));
      expect(retried.source_context).toEqual({
        tier: "pinned-preview",
        pixel_scale: 0.5,
        resolution_limited: true,
      });
      expect(retryEnvelope.warnings).toContainEqual(
        expect.objectContaining({ code: "source_resolution_limited" }),
      );
      expect(fixture.generationCalls()).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  test("a changed instruction is not mistaken for an upscale-only retry", async () => {
    const fixture = await fillUpscaleFixture({
      generationMode: "smallerdims",
      upscaleMode: "transport-failure",
    });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]);
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--prompt",
        "Replace the selection with a blue vase",
        "--pad",
        "0",
      ]);
      expect(fixture.generationCalls()).toBe(2);
    } finally {
      await fixture.close();
    }
  });

  test("a noncanonical composite is not mistaken for an upscale-only retry", async () => {
    const fixture = await fillUpscaleFixture({
      generationMode: "smallerdims",
      upscaleMode: "transport-failure",
    });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const args = [fixture.id, "--layer", segmented.layer_id, "--remove", "--pad", "0"];
      const first = fillStrictDataSchema.parse(
        success(await fixtureCommand(fixture, "fill", args)),
      );
      await fixture.handle.query(
        "UPDATE image_nodes SET parameters = '{\"feather\":1}'::jsonb WHERE photo_id = $1 AND id = $2",
        [fixture.id, first.composite.node],
      );
      const second = fillStrictDataSchema.parse(
        success(await fixtureCommand(fixture, "fill", args)),
      );

      expect(second.generation.node).not.toBe(first.generation.node);
      expect(fixture.generationCalls()).toBe(2);
    } finally {
      await fixture.close();
    }
  });
});
