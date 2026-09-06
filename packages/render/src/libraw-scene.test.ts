import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "vitest";
import { LibrawDecoder, type ImageSource } from "./decoder.js";
import { toSceneLinearRec2020 } from "./color.js";
import { decodeLibraw } from "@photoctl/img";

const hash = (pixels: Float32Array) =>
  createHash("sha256")
    .update(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength))
    .digest("hex");

test("native decode rejects an unsupported output space before opening the source", async () => {
  await expect(
    Reflect.apply(decodeLibraw, undefined, ["/missing.raw", 1, "display-srgb"]),
  ).rejects.toThrow("unsupported decode output space");
});

test("LibRaw scene output preserves resize-before-camera-front pixels and canonical metadata", async () => {
  const source: ImageSource = {
    kind: "online-file",
    path: join(process.cwd(), "fixtures/a7c2.ARW"),
    mediaType: "image/x-sony-arw",
  };
  const decoder = new LibrawDecoder();
  const camera = await decoder.decode(source, { scale: 0.25 });
  expect(camera.space).toBe("camera");
  const expected = await toSceneLinearRec2020(camera);
  const actual = await decoder.decode(source, { scale: 0.25, outputSpace: "scene-linear-rec2020" });
  expect(actual).toMatchObject({
    w: 1752,
    h: 1168,
    space: "scene-linear-rec2020",
    orientationApplied: true,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  });
  expect(hash(actual.data)).toBe(hash(expected.data));
  expect(Object.hasOwn(actual, "camXyz")).toBe(false);
  expect(Object.hasOwn(actual, "asShotWb")).toBe(false);
  expect(await toSceneLinearRec2020(actual)).toBe(actual);
}, 30_000);
