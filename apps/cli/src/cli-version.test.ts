import { describe, expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";

describe("photoctl CLI", () => {
  test("reports its version through the stable envelope", async () => {
    const result = await spawnPhotoctl(["--version"]);
    expect(result.code).toBe(0);
    expect(result.json).toEqual({ schema: 1, ok: true, data: { version: "0.1.0" }, warnings: [] });
  });

  test("maps an unknown verb to usage", async () => {
    const result = await spawnPhotoctl(["not-a-command"]);
    expect(result.code).toBe(2);
    expect(result.json).toMatchObject({ schema: 1, ok: false, code: "usage" });
  });
});
