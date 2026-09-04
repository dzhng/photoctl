import type { LinearImage } from "./decoder.js";
import { readFile } from "node:fs/promises";
import { linearRec2020ProfilePath } from "./color.js";

const IFD_OFFSET = 8;
const ENTRY_COUNT = 13;
const IFD_BYTES = 2 + ENTRY_COUNT * 12 + 4;
const BITS_OFFSET = IFD_OFFSET + IFD_BYTES;
const SAMPLE_FORMAT_OFFSET = BITS_OFFSET + 6;
const ICC_OFFSET = SAMPLE_FORMAT_OFFSET + 6;

export async function encodeLinearTiff(image: LinearImage): Promise<Buffer> {
  if (image.space !== "scene-linear-rec2020") {
    throw new Error("Linear TIFF accepts only developed Rec.2020 samples");
  }
  const range = image.whiteLevel - image.blackLevel;
  if (!(range > 0)) throw new Error("Linear image has an invalid black/white range");
  const profile = await readFile(linearRec2020ProfilePath);
  const pixelsOffset = ICC_OFFSET + profile.length + (profile.length % 2);
  const pixelBytes = image.data.length * Uint16Array.BYTES_PER_ELEMENT;
  const output = Buffer.alloc(pixelsOffset + pixelBytes);
  output.write("II", 0, "ascii");
  output.writeUInt16LE(42, 2);
  output.writeUInt32LE(IFD_OFFSET, 4);
  output.writeUInt16LE(ENTRY_COUNT, IFD_OFFSET);

  let entry = IFD_OFFSET + 2;
  entry = writeIfdEntry(output, entry, 256, 4, 1, image.w);
  entry = writeIfdEntry(output, entry, 257, 4, 1, image.h);
  entry = writeIfdEntry(output, entry, 258, 3, 3, BITS_OFFSET);
  entry = writeIfdEntry(output, entry, 259, 3, 1, 1);
  entry = writeIfdEntry(output, entry, 262, 3, 1, 2);
  entry = writeIfdEntry(output, entry, 273, 4, 1, pixelsOffset);
  entry = writeIfdEntry(output, entry, 274, 3, 1, 1);
  entry = writeIfdEntry(output, entry, 277, 3, 1, 3);
  entry = writeIfdEntry(output, entry, 278, 4, 1, image.h);
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

  for (let index = 0; index < image.data.length; index += 1) {
    const value = image.data[index];
    const sample = Math.round(Math.max(0, Math.min(1, value)) * 65_535);
    output.writeUInt16LE(sample, pixelsOffset + index * 2);
  }
  return output;
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
