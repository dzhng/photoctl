import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resampleDisplaySrgb8, resampleDisplaySrgbRegion } from "@photoctl/img";
import sharp from "sharp";
import { expect, test } from "vitest";
import { srgb2014ProfilePath } from "./color.js";
import { materializePreview } from "./preview.js";
import { PreviewCoordinator } from "./preview-coordinator.js";

test("preview pixels use Rust bilinear while Sharp performs no intermediate resize", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-preview-resampler-"));
  const sourcePath = join(directory, "source.png");
  const photo = { contentKey: "ck_aaaaaaaaaaaaaaaa", orientation: 1 as const, w: 5, h: 3 };
  try {
    await sharp(
      Buffer.from([
        0, 0, 0, 20, 0, 0, 80, 0, 0, 160, 0, 0, 255, 0, 0, 0, 100, 0, 20, 100, 0, 80, 100, 0, 160,
        100, 0, 255, 100, 0, 0, 255, 0, 20, 255, 0, 80, 255, 0, 160, 255, 0, 255, 255, 0,
      ]),
      { raw: { width: 5, height: 3, channels: 3 } },
    )
      .png()
      .toFile(sourcePath);
    const pipelinePrototype = Object.getPrototypeOf(sharp(sourcePath)) as {
      resize: ReturnType<typeof sharp>["resize"];
    };
    const originalResize = pipelinePrototype.resize;
    let resizeCalls = 0;
    pipelinePrototype.resize = function (...arguments_: unknown[]) {
      resizeCalls += 1;
      return Reflect.apply(originalResize, this, arguments_);
    } as typeof originalResize;
    let preview;
    try {
      preview = await materializePreview({
        coordinator: new PreviewCoordinator(),
        index: { recordCompleted: async () => {}, touch: async () => {} },
        cacheRoot: directory,
        photoId: "photo-resampler",
        renderHash: `r_${"a".repeat(64)}`,
        photo,
        source: { kind: "online-file", path: sourcePath, mediaType: "image/png", w: 5, h: 3 },
        view: { region: null, longEdge: 3 },
      });
    } finally {
      pipelinePrototype.resize = originalResize;
    }

    expect(resizeCalls).toBe(0);
    const masterPath = join(
      directory,
      "view",
      "photo-resampler",
      `r_${"a".repeat(64)}`,
      "master.jpg",
    );
    const { data: master, info } = await sharp(masterPath)
      .flatten({ background: "white" })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const expectedPixels = Buffer.from(resampleDisplaySrgb8(master, info.width, info.height, 3, 2));
    const sharpDefault = await sharp(master, {
      raw: { width: info.width, height: info.height, channels: 3 },
    })
      .resize(3, 2)
      .raw()
      .toBuffer();
    expect(expectedPixels).not.toEqual(sharpDefault);
    const expected = await sharp(expectedPixels, { raw: { width: 3, height: 2, channels: 3 } })
      .flatten({ background: "white" })
      .toColourspace("srgb")
      .jpeg({ quality: 88 })
      .withIccProfile(srgb2014ProfilePath)
      .toBuffer();

    expect(await readFile(preview.path)).toEqual(expected);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("a rendered U16 view crops and resamples before 8-bit encoding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-preview-u16-resampler-"));
  const probe = sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } });
  const prototype = Object.getPrototypeOf(probe) as { raw: typeof probe.raw };
  const originalRaw = prototype.raw;
  let rawOutputCalls = 0;
  prototype.raw = function (...arguments_: unknown[]) {
    rawOutputCalls += 1;
    return Reflect.apply(originalRaw, this, arguments_);
  } as typeof originalRaw;
  const data = new Uint16Array(2_000 * 6 * 3);
  for (let index = 0; index < data.length; index += 1) data[index] = (index * 997) % 65_536;
  try {
    const preview = await materializePreview({
      coordinator: new PreviewCoordinator(),
      index: { recordCompleted: async () => {}, touch: async () => {} },
      cacheRoot: directory,
      photoId: "photo-u16-resampler",
      renderHash: `r_${"b".repeat(64)}`,
      photo: { orientation: 1, w: 2_000, h: 6 },
      source: {
        kind: "online-file",
        path: "unused",
        mediaType: "image/png",
        w: 2_000,
        h: 6,
      },
      render: async () => ({
        w: 2_000,
        h: 6,
        channels: 3,
        data,
        space: "display-srgb",
        orientationApplied: true,
      }),
      view: { region: null, longEdge: 1_616 },
    });

    expect(rawOutputCalls).toBe(0);
    expect(preview).toMatchObject({ w: 1_616, h: 5 });
    const expectedPixels = resampleDisplaySrgbRegion(data, 2_000, 6, 0, 0, 2_000, 6, 1_616, 5);
    const expected = await sharp(
      Buffer.from(Array.from(expectedPixels, (sample) => Math.round(sample / 257))),
      { raw: { width: 1_616, height: 5, channels: 3 } },
    )
      .flatten({ background: "white" })
      .toColourspace("srgb")
      .jpeg({ quality: 88 })
      .withIccProfile(srgb2014ProfilePath)
      .toBuffer();
    expect(await readFile(preview.path)).toEqual(expected);
  } finally {
    prototype.raw = originalRaw;
    await rm(directory, { recursive: true });
  }
});
