import type { LinearImage } from "./decoder.js";
import { readFile } from "node:fs/promises";
import { linearRec2020ProfilePath, srgb2014ProfilePath } from "./color.js";
import type { Image16 } from "./source-render.js";

const IFD_OFFSET = 8;
const ENTRY_COUNT = 13;
const IFD_BYTES = 2 + ENTRY_COUNT * 12 + 4;
const BITS_OFFSET = IFD_OFFSET + IFD_BYTES;
const SAMPLE_FORMAT_OFFSET = BITS_OFFSET + 6;
const ICC_OFFSET = SAMPLE_FORMAT_OFFSET + 6;

export async function encodeLinearTiff(image: LinearImage): Promise<Buffer> {
  if (
    image.space !== "scene-linear-rec2020" ||
    !image.orientationApplied ||
    image.data.length !== image.w * image.h * 3
  ) {
    throw new Error("Linear TIFF accepts only developed Rec.2020 samples");
  }
  const range = image.whiteLevel - image.blackLevel;
  if (!(range > 0)) throw new Error("Linear image has an invalid black/white range");
  const samples = new Uint16Array(image.data.length);
  for (let index = 0; index < image.data.length; index += 1) {
    samples[index] = Math.round(Math.max(0, Math.min(1, image.data[index])) * 65_535);
  }
  return encodeRgb16Tiff(image.w, image.h, samples, await readFile(linearRec2020ProfilePath));
}

/** Encodes exact working pixels for the internal content-addressed graph artifact. */
export async function encodeArtifactLinearTiff(image: LinearImage): Promise<Buffer> {
  if (
    image.space !== "scene-linear-rec2020" ||
    !image.orientationApplied ||
    image.data.length !== image.w * image.h * 3
  ) {
    throw new Error("Artifact TIFF accepts only oriented scene-linear Rec.2020 samples");
  }
  const range = image.whiteLevel - image.blackLevel;
  if (!(range > 0)) throw new Error("Linear image has an invalid black/white range");
  return encodeRgbFloatTiff(image.w, image.h, image.data, await readFile(linearRec2020ProfilePath));
}

/** Reads photoctl's deterministic uncompressed IEEE-f32 graph artifact TIFF. */
export async function decodeArtifactLinearTiff(bytes: Buffer): Promise<LinearImage> {
  if (bytes.toString("ascii", 0, 2) !== "II" || bytes.readUInt16LE(2) !== 42) {
    throw new Error("Linear TIFF has an invalid header");
  }
  const entries = readIfd(bytes);
  const width = requiredScalar(entries, 256);
  const height = requiredScalar(entries, 257);
  const pixelOffset = requiredScalar(entries, 273);
  const pixelBytes = requiredScalar(entries, 279);
  const profileEntry = entries.get(34675);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    requiredValues(bytes, entries, 258).some((value) => value !== 32) ||
    requiredValues(bytes, entries, 339).some((value) => value !== 3) ||
    requiredScalar(entries, 259) !== 1 ||
    requiredScalar(entries, 262) !== 2 ||
    requiredScalar(entries, 274) !== 1 ||
    requiredScalar(entries, 277) !== 3 ||
    requiredScalar(entries, 278) !== height ||
    requiredScalar(entries, 284) !== 1 ||
    pixelBytes !== width * height * 3 * Float32Array.BYTES_PER_ELEMENT ||
    pixelOffset + pixelBytes !== bytes.length ||
    !profileEntry
  ) {
    throw new Error("Linear TIFF failed canonical validation");
  }
  const expectedProfile = await readFile(linearRec2020ProfilePath);
  if (
    !bytes
      .subarray(profileEntry.value, profileEntry.value + profileEntry.count)
      .equals(expectedProfile)
  ) {
    throw new Error("Linear TIFF has the wrong color profile");
  }
  const data = new Float32Array(width * height * 3);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = bytes.readFloatLE(pixelOffset + index * Float32Array.BYTES_PER_ELEMENT);
  }
  return {
    w: width,
    h: height,
    orientationApplied: true,
    space: "scene-linear-rec2020",
    data,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
}

export async function encodeDisplayTiff(image: Image16): Promise<Buffer> {
  if (
    image.space !== "display-srgb" ||
    image.channels !== 3 ||
    !image.orientationApplied ||
    image.data.length !== image.w * image.h * 3
  ) {
    throw new Error("Display TIFF accepts only oriented display-sRGB RGB16 samples");
  }
  return encodeRgb16Tiff(image.w, image.h, image.data, await readFile(srgb2014ProfilePath));
}

function encodeRgb16Tiff(
  width: number,
  height: number,
  samples: Uint16Array,
  profile: Buffer,
): Buffer {
  const pixelsOffset = ICC_OFFSET + profile.length + (profile.length % 2);
  const pixelBytes = samples.length * Uint16Array.BYTES_PER_ELEMENT;
  const output = Buffer.alloc(pixelsOffset + pixelBytes);
  output.write("II", 0, "ascii");
  output.writeUInt16LE(42, 2);
  output.writeUInt32LE(IFD_OFFSET, 4);
  output.writeUInt16LE(ENTRY_COUNT, IFD_OFFSET);

  let entry = IFD_OFFSET + 2;
  entry = writeIfdEntry(output, entry, 256, 4, 1, width);
  entry = writeIfdEntry(output, entry, 257, 4, 1, height);
  entry = writeIfdEntry(output, entry, 258, 3, 3, BITS_OFFSET);
  entry = writeIfdEntry(output, entry, 259, 3, 1, 1);
  entry = writeIfdEntry(output, entry, 262, 3, 1, 2);
  entry = writeIfdEntry(output, entry, 273, 4, 1, pixelsOffset);
  entry = writeIfdEntry(output, entry, 274, 3, 1, 1);
  entry = writeIfdEntry(output, entry, 277, 3, 1, 3);
  entry = writeIfdEntry(output, entry, 278, 4, 1, height);
  entry = writeIfdEntry(output, entry, 279, 4, 1, pixelBytes);
  entry = writeIfdEntry(output, entry, 284, 3, 1, 1);
  entry = writeIfdEntry(output, entry, 339, 3, 3, SAMPLE_FORMAT_OFFSET);
  entry = writeIfdEntry(output, entry, 34675, 7, profile.length, ICC_OFFSET);
  output.writeUInt32LE(0, entry);
  for (let channel = 0; channel < 3; channel += 1) {
    output.writeUInt16LE(16, BITS_OFFSET + channel * 2);
    output.writeUInt16LE(1, SAMPLE_FORMAT_OFFSET + channel * 2);
  }
  profile.copy(output, ICC_OFFSET);

  for (let index = 0; index < samples.length; index += 1) {
    output.writeUInt16LE(samples[index], pixelsOffset + index * 2);
  }
  return output;
}

function encodeRgbFloatTiff(
  width: number,
  height: number,
  samples: Float32Array,
  profile: Buffer,
): Buffer {
  const pixelsOffset = ICC_OFFSET + profile.length + (profile.length % 2);
  const pixelBytes = samples.length * Float32Array.BYTES_PER_ELEMENT;
  const output = Buffer.alloc(pixelsOffset + pixelBytes);
  output.write("II", 0, "ascii");
  output.writeUInt16LE(42, 2);
  output.writeUInt32LE(IFD_OFFSET, 4);
  output.writeUInt16LE(ENTRY_COUNT, IFD_OFFSET);

  let entry = IFD_OFFSET + 2;
  entry = writeIfdEntry(output, entry, 256, 4, 1, width);
  entry = writeIfdEntry(output, entry, 257, 4, 1, height);
  entry = writeIfdEntry(output, entry, 258, 3, 3, BITS_OFFSET);
  entry = writeIfdEntry(output, entry, 259, 3, 1, 1);
  entry = writeIfdEntry(output, entry, 262, 3, 1, 2);
  entry = writeIfdEntry(output, entry, 273, 4, 1, pixelsOffset);
  entry = writeIfdEntry(output, entry, 274, 3, 1, 1);
  entry = writeIfdEntry(output, entry, 277, 3, 1, 3);
  entry = writeIfdEntry(output, entry, 278, 4, 1, height);
  entry = writeIfdEntry(output, entry, 279, 4, 1, pixelBytes);
  entry = writeIfdEntry(output, entry, 284, 3, 1, 1);
  entry = writeIfdEntry(output, entry, 339, 3, 3, SAMPLE_FORMAT_OFFSET);
  entry = writeIfdEntry(output, entry, 34675, 7, profile.length, ICC_OFFSET);
  output.writeUInt32LE(0, entry);
  for (let channel = 0; channel < 3; channel += 1) {
    output.writeUInt16LE(32, BITS_OFFSET + channel * 2);
    output.writeUInt16LE(3, SAMPLE_FORMAT_OFFSET + channel * 2);
  }
  profile.copy(output, ICC_OFFSET);
  for (let index = 0; index < samples.length; index += 1) {
    output.writeFloatLE(samples[index], pixelsOffset + index * Float32Array.BYTES_PER_ELEMENT);
  }
  return output;
}

interface IfdEntry {
  type: number;
  count: number;
  value: number;
}

function readIfd(bytes: Buffer): Map<number, IfdEntry> {
  const offset = bytes.readUInt32LE(4);
  const count = bytes.readUInt16LE(offset);
  const entries = new Map<number, IfdEntry>();
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 2 + index * 12;
    entries.set(bytes.readUInt16LE(entry), {
      type: bytes.readUInt16LE(entry + 2),
      count: bytes.readUInt32LE(entry + 4),
      value: bytes.readUInt32LE(entry + 8),
    });
  }
  return entries;
}

function requiredScalar(entries: Map<number, IfdEntry>, tag: number): number {
  const entry = entries.get(tag);
  if (!entry || entry.count !== 1 || (entry.type !== 3 && entry.type !== 4)) {
    throw new Error(`Linear TIFF is missing scalar tag ${tag}`);
  }
  return entry.type === 3 ? entry.value & 0xffff : entry.value;
}

function requiredValues(bytes: Buffer, entries: Map<number, IfdEntry>, tag: number): number[] {
  const entry = entries.get(tag);
  if (!entry || entry.type !== 3 || entry.count !== 3) {
    throw new Error(`Linear TIFF is missing RGB tag ${tag}`);
  }
  return Array.from({ length: entry.count }, (_, index) =>
    bytes.readUInt16LE(entry.value + index * 2),
  );
}

function writeIfdEntry(
  output: Buffer,
  offset: number,
  tag: number,
  type: number,
  count: number,
  value: number,
): number {
  output.writeUInt16LE(tag, offset);
  output.writeUInt16LE(type, offset + 2);
  output.writeUInt32LE(count, offset + 4);
  if (type === 3 && count === 1) {
    output.writeUInt16LE(value, offset + 8);
    output.writeUInt16LE(0, offset + 10);
  } else {
    output.writeUInt32LE(value, offset + 8);
  }
  return offset + 12;
}
