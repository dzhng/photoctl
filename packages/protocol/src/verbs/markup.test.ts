import { describe, expect, test } from "vitest";
import { markupDocumentSchema, markupItemInputSchema } from "./markup.js";

describe("markup item contract", () => {
  test.each([
    { type: "text", at: [12, 14], text: "Proof", size_px: 18, color: "#ff0000" },
    { type: "arrow", from: [1, 2], to: [10, 20], width: 3, color: "#00ff00" },
    { type: "line", from: [1, 2], to: [10, 20], width: 3, color: "#00ff00ff" },
    { type: "rect", bbox: [1, 2, 10, 20], width: 3, color: "#0000ff", fill: "#ffffff80" },
    { type: "ellipse", bbox: [1, 2, 10, 20], width: 3, color: "#0000ff" },
    {
      type: "path",
      points: [
        [1, 2],
        [10, 20],
      ],
      width: 3,
      color: "#123456",
    },
    { type: "highlight", bbox: [1, 2, 10, 20], color: "#ffff00", opacity: 0.4 },
  ])("accepts $type and assigns no hidden defaults", (item) => {
    expect(markupItemInputSchema.parse(item)).toEqual(item);
  });

  test.each([
    { type: "text", at: [0, 0], text: "", size_px: 12, color: "red" },
    { type: "line", from: [0, 0], to: [1, 1], width: 0, color: "#000000" },
    { type: "rect", bbox: [0, 0, -1, 2], width: 1, color: "#000000" },
    { type: "path", points: [[0, 0]], width: 1, color: "#000000" },
    { type: "highlight", bbox: [0, 0, 1, 2], color: "#ffff00", opacity: 2 },
    { type: "line", from: [-1e308, 0], to: [1e308, 0], width: 1, color: "#000000" },
    { type: "line", from: [0, 0], to: [1, 1], width: 1, color: "#000000", surprise: true },
  ])("rejects malformed markup %#", (item) => {
    expect(() => markupItemInputSchema.parse(item)).toThrow();
  });

  test("stored documents require stable UUID identities", () => {
    expect(
      markupDocumentSchema.parse([
        {
          id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c170",
          type: "highlight",
          bbox: [1, 2, 10, 20],
          color: "#ffff00",
          opacity: 0.4,
        },
      ]),
    ).toHaveLength(1);
    expect(() =>
      markupDocumentSchema.parse([
        { id: "not-an-id", type: "line", from: [0, 0], to: [1, 1], width: 1, color: "#000000" },
      ]),
    ).toThrow();
  });

  test("stored documents reject text that exceeds the native raster budget", () => {
    expect(() =>
      markupDocumentSchema.parse([
        {
          id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c170",
          type: "text",
          at: [0, 0],
          text: "A",
          size_px: 10_000,
          color: "#ffffff",
        },
      ]),
    ).toThrow("markup text exceeds the rasterization budget");
  });

  test("stored documents enforce the native aggregate path-point limit", () => {
    const path = {
      id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c170",
      type: "path" as const,
      points: Array.from({ length: 8_192 }, () => [0, 0] as [number, number]),
      width: 1,
      color: "#ffffff",
    };
    expect(() => markupDocumentSchema.parse(Array.from({ length: 9 }, () => path))).toThrow(
      "markup document has too many path points",
    );
  });
});
