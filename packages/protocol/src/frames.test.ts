import { expect, test } from "vitest";
import { FrameDecoder, encodeFrame } from "./frames.js";

test("length-prefixed frames survive arbitrary socket chunk boundaries", () => {
  const first = encodeFrame({ type: "control", action: "status" });
  const second = encodeFrame({ type: "response", envelope: { schema: 1, ok: true } });
  const bytes = Buffer.concat([first, second]);
  const decoder = new FrameDecoder();

  expect(decoder.push(bytes.subarray(0, 2))).toEqual([]);
  expect(decoder.push(bytes.subarray(2, first.length + 3))).toEqual([
    { type: "control", action: "status" },
  ]);
  expect(decoder.push(bytes.subarray(first.length + 3))).toEqual([
    { type: "response", envelope: { schema: 1, ok: true } },
  ]);
});
