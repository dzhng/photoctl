import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "vitest";
import { encodeLinearTiff, linearRec2020ProfilePath } from "./index.js";

test("linear TIFF embeds the canonical Rec.2020 profile without changing samples", async () => {
  const source = new Float32Array([0, 0.25, 1, 0.5, 0.75, 0.125]);
  const encoded = await encodeLinearTiff({
    w: 2,
    h: 1,
    orientationApplied: true,
    space: "scene-linear-rec2020",
    data: source,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  });
  const profile = await readFile(linearRec2020ProfilePath);
  const metadata = await sharp(encoded).metadata();

  expect(metadata.icc).toEqual(profile);
  expect(readTiffSamples(encoded)).toEqual([0, 16_384, 65_535, 32_768, 49_151, 8192]);
  expect(readIccTagSignatures(profile)).toEqual(
    expect.arrayContaining([
      "desc",
      "cprt",
      "wtpt",
      "chad",
      "rXYZ",
      "gXYZ",
      "bXYZ",
      "rTRC",
      "gTRC",
      "bTRC",
    ]),
  );
  expect(profile.toString("ascii", 16, 20)).toBe("RGB ");
  expect(profile.readUInt32BE(8) >>> 24).toBe(4);
  expect(createHash("sha256").update(profile).digest("hex")).toBe(
    "e5ef19e5e8c289edb6310037fd5e890bdaf44c7534ad20893aa826505737cc17",
  );
  const profileIdInput = Buffer.from(profile);
  profileIdInput.fill(0, 44, 48);
  profileIdInput.fill(0, 64, 68);
  profileIdInput.fill(0, 84, 100);
  expect(profile.subarray(84, 100)).toEqual(createHash("md5").update(profileIdInput).digest());
  expect(readXyzTag(profile, "rXYZ")).toEqual([
    expect.closeTo(0.673477, 5),
    expect.closeTo(0.279037, 5),
    expect.closeTo(-0.001938, 5),
  ]);
  expect(readXyzTag(profile, "gXYZ")).toEqual([
    expect.closeTo(0.165665, 5),
    expect.closeTo(0.675339, 5),
    expect.closeTo(0.029984, 5),
  ]);
  expect(readXyzTag(profile, "bXYZ")).toEqual([
    expect.closeTo(0.125046, 5),
    expect.closeTo(0.045609, 5),
    expect.closeTo(0.796844, 5),
  ]);
  for (const tag of ["rTRC", "gTRC", "bTRC"]) expect(readParametricGamma(profile, tag)).toBe(1);
});

function readIccTagSignatures(profile: Buffer): string[] {
  const count = profile.readUInt32BE(128);
  return Array.from({ length: count }, (_, index) =>
    profile.toString("ascii", 132 + index * 12, 136 + index * 12),
  );
}

function tagOffset(profile: Buffer, signature: string): number {
  const count = profile.readUInt32BE(128);
  const entry = Array.from({ length: count }, (_, index) => 132 + index * 12).find(
    (offset) => profile.toString("ascii", offset, offset + 4) === signature,
  );
  if (entry === undefined) throw new Error(`ICC has no ${signature} tag`);
  return profile.readUInt32BE(entry + 4);
}

function readXyzTag(profile: Buffer, signature: string): number[] {
  const offset = tagOffset(profile, signature);
  expect(profile.toString("ascii", offset, offset + 4)).toBe("XYZ ");
  return [0, 1, 2].map((index) => profile.readInt32BE(offset + 8 + index * 4) / 65_536);
}

function readParametricGamma(profile: Buffer, signature: string): number {
  const offset = tagOffset(profile, signature);
  expect(profile.toString("ascii", offset, offset + 4)).toBe("para");
  expect(profile.readUInt16BE(offset + 8)).toBe(0);
  return profile.readInt32BE(offset + 12) / 65_536;
}

function readTiffSamples(tiff: Buffer): number[] {
  const ifd = tiff.readUInt32LE(4);
  const count = tiff.readUInt16LE(ifd);
  const strip = Array.from({ length: count }, (_, index) => ifd + 2 + index * 12).find(
    (offset) => tiff.readUInt16LE(offset) === 273,
  );
  if (strip === undefined) throw new Error("TIFF has no strip offset");
  const pixelOffset = tiff.readUInt32LE(strip + 8);
  return Array.from({ length: 6 }, (_, index) => tiff.readUInt16LE(pixelOffset + index * 2));
}
