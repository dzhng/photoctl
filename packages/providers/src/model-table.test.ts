import { describe, expect, test } from "vitest";
import { DEFAULT_MODELS, resolveModel, resolveModels } from "./table.js";

describe("the fixed provider model table", () => {
  test("resolves release defaults without runtime capability discovery", () => {
    expect(resolveModels()).toEqual(DEFAULT_MODELS);
    expect(DEFAULT_MODELS).toMatchObject({
      edit: "openai/gpt-image-2",
      generate: "openai/gpt-image-2",
      structured: "google/gemini-3.1-flash",
      embed: "google/gemini-embedding-2",
    });
  });
});

test("a command model override wins over the library model for one purpose", () => {
  expect(resolveModel("edit", { edit: "library/edit-v1" }, "command/edit-v2")).toBe(
    "command/edit-v2",
  );
});

test("symbolic moving model ids cannot enter resolved provenance", () => {
  expect(() => resolveModel("edit", {}, "latest")).toThrow("concrete model id");
  expect(() => resolveModels({ upscale: "auto" })).toThrow("concrete model id");
});
