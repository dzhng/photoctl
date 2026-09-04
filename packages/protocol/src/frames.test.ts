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

test("both sides refuse a daemon frame above the protocol ceiling", () => {
  expect(() => encodeFrame({ row: "x".repeat(16 * 1024 * 1024) })).toThrow(
    "Daemon frame exceeds 16 MiB",
  );
  const header = Buffer.alloc(4);
  header.writeUInt32BE(16 * 1024 * 1024 + 1);
  expect(() => new FrameDecoder().push(header)).toThrow("Daemon frame exceeds 16 MiB");
});
