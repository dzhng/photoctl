export interface MaskImage {
  w: number;
  h: number;
  data: Float32Array;
}

const IFD_OFFSET = 8;
const ENTRY_COUNT = 11;
const PIXEL_OFFSET = IFD_OFFSET + 2 + ENTRY_COUNT * 12 + 4;

/** Encodes the canonical uncompressed, single-channel IEEE-f32 mask artifact. */
export function encodeMaskTiff(mask: MaskImage): Buffer {
  if (
    !Number.isSafeInteger(mask.w) ||
    !Number.isSafeInteger(mask.h) ||
    mask.w <= 0 ||
    mask.h <= 0 ||
    mask.data.length !== mask.w * mask.h ||
    !mask.data.every((sample) => Number.isFinite(sample) && sample >= 0 && sample <= 1)
  ) {
    throw new Error("Mask TIFF accepts only finite single-channel coverage in [0,1]");
  }
  const pixelBytes = mask.data.length * Float32Array.BYTES_PER_ELEMENT;
  const output = Buffer.alloc(PIXEL_OFFSET + pixelBytes);
  output.write("II", 0, "ascii");
  output.writeUInt16LE(42, 2);
  output.writeUInt32LE(IFD_OFFSET, 4);
  output.writeUInt16LE(ENTRY_COUNT, IFD_OFFSET);
  let entry = IFD_OFFSET + 2;
  entry = writeEntry(output, entry, 256, 4, 1, mask.w);
  entry = writeEntry(output, entry, 257, 4, 1, mask.h);
  entry = writeEntry(output, entry, 258, 3, 1, 32);
  entry = writeEntry(output, entry, 259, 3, 1, 1);
  entry = writeEntry(output, entry, 262, 3, 1, 1);
  entry = writeEntry(output, entry, 273, 4, 1, PIXEL_OFFSET);
  entry = writeEntry(output, entry, 274, 3, 1, 1);
  entry = writeEntry(output, entry, 277, 3, 1, 1);
  entry = writeEntry(output, entry, 278, 4, 1, mask.h);
  entry = writeEntry(output, entry, 279, 4, 1, pixelBytes);
  entry = writeEntry(output, entry, 339, 3, 1, 3);
  output.writeUInt32LE(0, entry);
  for (let index = 0; index < mask.data.length; index += 1) {
    output.writeFloatLE(mask.data[index], PIXEL_OFFSET + index * Float32Array.BYTES_PER_ELEMENT);
  }
  return output;
}

export function decodeMaskTiff(bytes: Buffer): MaskImage {
  const layout = inspectMaskTiff(bytes);
  const data = new Float32Array(layout.w * layout.h);
  for (let index = 0; index < data.length; index += 1) {
    const sample = bytes.readFloatLE(layout.pixelOffset + index * Float32Array.BYTES_PER_ELEMENT);
    if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
      throw new Error("Mask TIFF contains coverage outside [0,1]");
    }
    data[index] = sample;
  }
  return { w: layout.w, h: layout.h, data };
}

export function validateMaskTiff(bytes: Buffer): { w: number; h: number } {
  const layout = inspectMaskTiff(bytes);
  for (let index = 0; index < layout.w * layout.h; index += 1) {
    const sample = bytes.readFloatLE(layout.pixelOffset + index * Float32Array.BYTES_PER_ELEMENT);
    if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
      throw new Error("Mask TIFF contains coverage outside [0,1]");
    }
  }
  return { w: layout.w, h: layout.h };
}

export function inspectMaskTiff(bytes: Buffer): {
  w: number;
  h: number;
  pixelOffset: number;
  pixelBytes: number;
} {
  if (
    bytes.length < PIXEL_OFFSET ||
    bytes.toString("ascii", 0, 2) !== "II" ||
    bytes.readUInt16LE(2) !== 42
  ) {
    throw new Error("Mask TIFF has an invalid header");
  }
  const offset = bytes.readUInt32LE(4);
  if (offset !== IFD_OFFSET || bytes.readUInt16LE(offset) !== ENTRY_COUNT) {
    throw new Error("Mask TIFF failed canonical validation");
  }
  const entries = new Map<number, { type: number; count: number; value: number }>();
  for (let index = 0; index < ENTRY_COUNT; index += 1) {
    const at = offset + 2 + index * 12;
    entries.set(bytes.readUInt16LE(at), {
      type: bytes.readUInt16LE(at + 2),
      count: bytes.readUInt32LE(at + 4),
      value: bytes.readUInt32LE(at + 8),
    });
  }
  const scalar = (tag: number): number => {
    const value = entries.get(tag);
    if (!value || value.count !== 1 || (value.type !== 3 && value.type !== 4)) {
      throw new Error(`Mask TIFF is missing scalar tag ${tag}`);
    }
    return value.type === 3 ? value.value & 0xffff : value.value;
  };
  const w = scalar(256);
  const h = scalar(257);
  const pixelOffset = scalar(273);
  const pixelBytes = scalar(279);
  if (
    !Number.isSafeInteger(w) ||
    !Number.isSafeInteger(h) ||
    w <= 0 ||
    h <= 0 ||
    scalar(258) !== 32 ||
    scalar(259) !== 1 ||
    scalar(262) !== 1 ||
    scalar(274) !== 1 ||
    scalar(277) !== 1 ||
    scalar(278) !== h ||
    scalar(339) !== 3 ||
    pixelOffset !== PIXEL_OFFSET ||
    pixelBytes !== w * h * Float32Array.BYTES_PER_ELEMENT ||
    pixelOffset + pixelBytes !== bytes.length
  ) {
    throw new Error("Mask TIFF failed canonical validation");
  }
  return { w, h, pixelOffset, pixelBytes };
}

function writeEntry(
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
