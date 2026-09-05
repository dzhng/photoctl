import { describe, expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { readFile } from "node:fs/promises";

describe("photoctl CLI", () => {
  test("reports its version through the stable envelope", async () => {
    const result = await spawnPhotoctl(["--version"]);
    const { version } = JSON.parse(await readFile("package.json", "utf8"));
    expect(result.code).toBe(0);
    expect(result.json).toEqual({ schema: 1, ok: true, data: { version }, warnings: [] });
  });

  test("maps an unknown verb to usage", async () => {
    const result = await spawnPhotoctl(["not-a-command"]);
    expect(result.code).toBe(2);
    expect(result.json).toMatchObject({ schema: 1, ok: false, code: "usage" });
  });
});
