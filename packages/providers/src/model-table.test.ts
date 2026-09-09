import { describe, expect, test } from "vitest";
import { DEFAULT_MODELS, resolveModel, resolveModels } from "./table.js";

describe("the fixed provider model table", () => {
  test("library model overrides affect only that library and purpose", () => {
    const defaults = { ...DEFAULT_MODELS };
    const libraryModels = { structured: "fixture/library-analysis-v1" };
    const resolved = resolveModels(libraryModels);
    expect(resolved).toEqual({ ...defaults, structured: "fixture/library-analysis-v1" });
    expect(resolveModel("structured", libraryModels)).toBe("fixture/library-analysis-v1");
    expect(resolveModel("edit", libraryModels)).toBe(defaults.edit);

    resolved.structured = "fixture/other-analysis-v1";
    expect(libraryModels).toEqual({ structured: "fixture/library-analysis-v1" });
    expect(resolveModels()).toEqual(defaults);
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

test("resolved model ids are bounded before entering provider or command frames", () => {
  expect(() => resolveModel("embed", {}, `vendor/${"x".repeat(250)}`)).toThrow("at most 256 bytes");
});
