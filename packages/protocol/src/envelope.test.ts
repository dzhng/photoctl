import { describe, expect, test } from "vitest";
import { exitCodeFor } from "./envelope.js";

describe("exitCodeFor", () => {
  test.each([
    ["usage", 2],
    ["unsupported_file", 65],
    ["file_offline", 69],
    ["library_locked", 75],
  ] as const)("maps %s to %i", (code, expected) => expect(exitCodeFor(code)).toBe(expected));
});
