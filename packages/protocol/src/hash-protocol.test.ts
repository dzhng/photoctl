import { expect, test } from "vitest";
import { exportResultSchema } from "./verbs/export.js";
import { showDataSchema } from "./verbs/show.js";

test("render and view protocol fields require the complete SHA-256 identity", () => {
  const full = "0".repeat(64);
  expect(showDataSchema.shape.render_hash.safeParse(`r_${full}`).success).toBe(true);
  expect(showDataSchema.shape.preview_info.shape.render_hash.safeParse(`r_${full}`).success).toBe(
    true,
  );
  expect(showDataSchema.shape.preview_info.shape.view_hash.safeParse(`v_${full}`).success).toBe(
    true,
  );
  expect(exportResultSchema.shape.render_hash.safeParse(`r_${full}`).success).toBe(true);

  expect(showDataSchema.shape.render_hash.safeParse("r_0123456789ab").success).toBe(false);
  expect(
    showDataSchema.shape.preview_info.shape.view_hash.safeParse("v_0123456789ab").success,
  ).toBe(false);
  expect(exportResultSchema.shape.render_hash.safeParse("r_0123456789ab").success).toBe(false);
});
