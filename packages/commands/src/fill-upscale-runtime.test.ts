import { FakeUpscaleAdapter } from "@photoctl/providers";
import { describe, expect, test, vi } from "vitest";
import { fillUpscaleFixture, fixtureCommand, success } from "./fill-upscale-fixture.js";

describe.sequential("fill production upscale wiring", () => {
  test("unconfigured runtime adapter preserves generation without sending pixels", async () => {
    const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const upscale = vi.spyOn(FakeUpscaleAdapter.prototype, "upscale");
    delete fixture.fill.upscaleRegistry;
    delete fixture.fill.upscaleSettings;
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const response = await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]);

      expect(response).toMatchObject({
        ok: true,
        warnings: [{ code: "upscale_unconfigured" }],
        data: { upscale: { enabled: true, executed: false, node: null } },
      });
      expect(upscale).not.toHaveBeenCalled();
    } finally {
      upscale.mockRestore();
      await fixture.close();
    }
  });

  test("persisted consent executes the runtime adapter without an injected registry", async () => {
    const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const upscale = vi.spyOn(FakeUpscaleAdapter.prototype, "upscale");
    delete fixture.fill.upscaleRegistry;
    delete fixture.fill.upscaleSettings;
    try {
      await fixture.handle.query(
        `INSERT INTO settings (key, value)
         VALUES ('providers', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [
          JSON.stringify({
            upscale: { "photoctl/fake-upscale-v1": { configured: true } },
          }),
        ],
      );
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const response = await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]);

      expect(response).toMatchObject({
        ok: true,
        warnings: [],
        data: {
          upscale: {
            enabled: true,
            executed: true,
            adapter: "photoctl/fake-upscale-v1",
            model: "photoctl/fake-upscale-v1",
            density_satisfied: true,
          },
        },
      });
      expect(upscale).toHaveBeenCalledOnce();
    } finally {
      upscale.mockRestore();
      await fixture.close();
    }
  });
});
