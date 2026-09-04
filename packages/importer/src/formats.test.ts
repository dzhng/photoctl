import { describe, expect, test } from "vitest";
import { classifyFormat } from "./formats.js";

describe("classifyFormat", () => {
  test("classifies every supported input from its case-insensitive extension", () => {
    expect(
      ["frame.ARW", "frame.jpg", "frame.JPEG", "frame.png", "frame.tif", "frame.TIFF"].map((path) =>
        classifyFormat(path),
      ),
    ).toEqual([
      { kind: "raw", source: "embedded" },
      { kind: "image", source: "file" },
      { kind: "image", source: "file" },
      { kind: "image", source: "file" },
      { kind: "image", source: "file" },
      { kind: "image", source: "file" },
    ]);
    expect(classifyFormat("notes.txt")).toBeUndefined();
    expect(classifyFormat("arw-without-an-extension")).toBeUndefined();
  });
});
