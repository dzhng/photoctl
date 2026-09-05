import { expect, test } from "vitest";
import { relightDataSchema } from "./relight.js";

test("relight response pins full-frame drift and bounded lighting controls", () => {
  const response = {
    id: "0199a7c2-0000-7000-8000-000000000001",
    layer_id: "0199a7c2-0000-7000-8000-000000000002",
    revision_id: "0199a7c2-0000-7000-8000-000000000003",
    render_hash: `r_${"1".repeat(64)}`,
    output_node: `node_${"2".repeat(64)}`,
    drift: "full-frame",
    azimuth: 35,
    elevation: 60,
    intensity: 0.75,
    generation: {
      node: `node_${"3".repeat(64)}`,
      adapter: "gateway-image-edit",
      model: "photoctl/fake-image-edit-v1",
      returned: { w: 80, h: 60 },
    },
    source_context: { tier: "online-file", pixel_scale: 1, resolution_limited: false },
    upscale: {
      enabled: false,
      executed: false,
      node: null,
      adapter: null,
      model: "photoctl/fake-upscale-v1",
      input: { w: 80, h: 60 },
      target: { w: 160, h: 120 },
      generated: { w: 80, h: 60 },
      final: { w: 160, h: 120 },
      density_satisfied: true,
      warnings: [],
    },
    executions: [
      {
        kind: "generate",
        node: `node_${"3".repeat(64)}`,
        adapter: "gateway-image-edit",
        model: "photoctl/fake-image-edit-v1",
        duration_ms: 10,
        cost_usd: 0,
        reused: false,
      },
    ],
  };
  expect(relightDataSchema.parse(response)).toEqual(response);
  expect(relightDataSchema.safeParse({ ...response, drift: "local" }).success).toBe(false);
  expect(relightDataSchema.safeParse({ ...response, intensity: 1.01 }).success).toBe(false);
});
