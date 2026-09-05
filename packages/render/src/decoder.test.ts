import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import sharp from "sharp";
import { resampleDisplaySrgb } from "@photoctl/img";
import { CirawDecoder, FileImageDecoder, LibrawDecoder, type ImageSource } from "./decoder.js";

test("the CIRAW adapter returns the shared linear-image contract from the helper wire", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-ciraw-adapter-"));
  const helper = join(directory, "fake-helper.mjs");
  const input = join(directory, "source.raw");
  await writeFile(input, "raw");
  await writeFile(
    helper,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "probe") {
  console.log(JSON.stringify({supported:true,supportedDecoderVersions:["8"],decoderVersion:"8",nativeWidth:8,nativeHeight:4}));
} else {
  const output = args[args.indexOf("--output") + 1];
  writeFileSync(output, Buffer.from(new Float32Array([0, 0.5, 1, 1, 0.5, 0]).buffer));
  console.log(JSON.stringify({width:2,height:1,channels:3,space:"scene-linear-rec2020",orientationApplied:true,wireFormat:"rgb-f32le",decoderVersion:"8"}));
}
`,
  );
  await chmod(helper, 0o755);
  const source: ImageSource = {
    kind: "online-file",
    path: input,
    mediaType: "image/x-sony-arw",
    w: 8,
    h: 4,
  };

  const decoder = new CirawDecoder(helper);
  expect(await decoder.probe(source)).toEqual({
    supported: true,
    compression: undefined,
    decoderVersion: "8",
    notes: ["Core Image RAW decoder 8"],
  });
  const image = await decoder.decode(source, { scale: 0.25 });
  expect(image).toMatchObject({
    w: 2,
    h: 1,
    orientationApplied: true,
    space: "scene-linear-rec2020",
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  });
  expect(Array.from(image.data)).toEqual([0, 0.5, 1, 1, 0.5, 0]);
  await rm(directory, { recursive: true });
});

test("the file adapter decodes content with a wrong extension into linear Rec.2020", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-file-adapter-"));
  const input = join(directory, "source.unknown");
  await sharp(new Uint8Array([255, 0, 0, 0, 255, 0]), {
    raw: { width: 2, height: 1, channels: 3 },
  })
    .png()
    .toFile(input);
  const source: ImageSource = {
    kind: "online-file",
    path: input,
    mediaType: "image/png",
    w: 2,
    h: 1,
  };

  const decoder = new FileImageDecoder();
  expect(await decoder.probe(source)).toEqual({
    supported: true,
    decoderVersion: sharp.versions.sharp,
    notes: [],
  });
  const image = await decoder.decode(source, { scale: 1 });
  expect(image).toMatchObject({
    w: 2,
    h: 1,
    orientationApplied: true,
    space: "scene-linear-rec2020",
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  });
  expect(image.data[0]).toBeCloseTo(0.6274, 3);
  expect(image.data[1]).toBeCloseTo(0.0691, 3);
  expect(image.data[2]).toBeCloseTo(0.0164, 3);
  await rm(directory, { recursive: true });
});

test("the scaled file adapter uses the native bilinear pixel route", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-file-resample-"));
  const input = join(directory, "source.png");
  const pixels = Buffer.from([
    0, 0, 0, 20, 0, 0, 80, 0, 0, 160, 0, 0, 255, 0, 0, 0, 100, 0, 20, 100, 0, 80, 100, 0, 160, 100,
    0, 255, 100, 0, 0, 255, 0, 20, 255, 0, 80, 255, 0, 160, 255, 0, 255, 255, 0,
  ]);
  try {
    await sharp(pixels, { raw: { width: 5, height: 3, channels: 3 } })
      .png()
      .toFile(input);
    const decoder = new FileImageDecoder();
    const source: ImageSource = {
      kind: "online-file",
      path: input,
      mediaType: "image/png",
      w: 5,
      h: 3,
    };
    const full = await decoder.decodeDisplay(source, { scale: 1 });
    const scaled = await decoder.decodeDisplay(source, { scale: 0.5 });

    expect(scaled).toEqual({
      w: 2,
      h: 1,
      data: resampleDisplaySrgb(full.data, full.w, full.h, 2, 1),
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("the LibRaw adapter reports compression and returns scaled camera-space pixels", async () => {
  const fixture = join(process.cwd(), "fixtures/a7c2.ARW");
  const source: ImageSource = {
    kind: "online-file",
    path: fixture,
    mediaType: "image/x-sony-arw",
    w: 7008,
    h: 4672,
  };

  const decoder = new LibrawDecoder();
  expect(await decoder.probe(source)).toEqual({
    supported: true,
    compression: 1,
    decoderVersion: "0.22.2-Release",
    notes: ["LibRaw 0.22.2-Release"],
  });
  const image = await decoder.decode(source, { scale: 0.25 });
  expect(image).toMatchObject({
    w: 1752,
    h: 1168,
    orientationApplied: true,
    space: "camera",
    whiteLevel: 15_871,
    blackLevel: 0,
    wbPreApplied: false,
  });
  expect(image.camXyz?.[0]).toBeCloseTo(0.746, 4);
  expect(image.asShotWb?.[0]).toBeCloseTo(2.3164, 3);
  expect(image.data).toHaveLength(1752 * 1168 * 3);
}, 30_000);
