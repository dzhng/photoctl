import { expect, test } from "vitest";
import { renderHuman } from "./output.js";

test("human output abbreviates full hashes without changing other strings", () => {
  const digest = "0123456789abcdef".repeat(4);
  const output = renderHuman({
    schema: 1,
    ok: true,
    data: {
      render_hash: `r_${digest}`,
      view_hash: `v_${digest}`,
      execution_id: `exec_${digest}`,
      label: `keep_${digest}`,
    },
    warnings: [],
  });

  expect(output).toContain("render_hash | r_0123456789ab");
  expect(output).toContain("view_hash | v_0123456789ab");
  expect(output).toContain("execution_id | exec_0123456789ab");
  expect(output).toContain(`label | keep_${digest}`);
  expect(output).not.toContain(`r_${digest}`);
});
