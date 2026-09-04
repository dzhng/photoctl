import type { Sharp } from "sharp";

export interface DeliveryMetadata {
  creator?: string;
  copyright?: string;
}

export function applyDeliveryMetadata(image: Sharp, metadata: DeliveryMetadata): Sharp {
  const ifd0: Record<string, string> = {};
  if (metadata.creator !== undefined) ifd0.Artist = metadata.creator;
  if (metadata.copyright !== undefined) ifd0.Copyright = metadata.copyright;
  let output = Object.keys(ifd0).length > 0 ? image.withExif({ IFD0: ifd0 }) : image;
  if (metadata.creator !== undefined || metadata.copyright !== undefined) {
    output = output.withXmp(renderXmp(metadata));
  }
  return output;
}

export function embedTiffMetadata(tiff: Buffer, metadata: DeliveryMetadata): Buffer {
  // libvips preserves TIFF XMP but drops Sharp's EXIF Artist/Copyright. A replacement
  // first IFD keeps every encoded image offset intact while adding those native TIFF tags.
  const additions = [
    ...(metadata.creator === undefined ? [] : [{ tag: 315, value: metadata.creator }]),
    ...(metadata.copyright === undefined ? [] : [{ tag: 33_432, value: metadata.copyright }]),
  ];
  if (additions.length === 0) return tiff;

  const littleEndian = tiff.subarray(0, 2).equals(Buffer.from("II"));
  const bigEndian = tiff.subarray(0, 2).equals(Buffer.from("MM"));
  const read16 = littleEndian ? Buffer.prototype.readUInt16LE : Buffer.prototype.readUInt16BE;
  const read32 = littleEndian ? Buffer.prototype.readUInt32LE : Buffer.prototype.readUInt32BE;
  const write16 = littleEndian ? Buffer.prototype.writeUInt16LE : Buffer.prototype.writeUInt16BE;
  const write32 = littleEndian ? Buffer.prototype.writeUInt32LE : Buffer.prototype.writeUInt32BE;
  if (!littleEndian && !bigEndian) throw new Error("Invalid TIFF byte order");
  if (read16.call(tiff, 2) !== 42) throw new Error("BigTIFF delivery metadata is unsupported");

  const firstIfd = read32.call(tiff, 4);
  const count = read16.call(tiff, firstIfd);
  const entriesStart = firstIfd + 2;
  const entriesEnd = entriesStart + count * 12;
  if (entriesEnd + 4 > tiff.length) throw new Error("Invalid TIFF image directory");

  const replacedTags = new Set(additions.map(({ tag }) => tag));
  const entries = Array.from({ length: count }, (_, index) =>
    tiff.subarray(entriesStart + index * 12, entriesStart + (index + 1) * 12),
  ).filter((entry) => !replacedTags.has(read16.call(entry, 0)));
  const encodedAdditions = additions.map(({ tag, value }) => ({
    tag,
    value: Buffer.from(`${value}\0`, "utf8"),
  }));
  const newIfd = (tiff.length + 1) & ~1;
  const newCount = entries.length + encodedAdditions.length;
  const directoryBytes = 2 + newCount * 12 + 4;
  let valueOffset = newIfd + directoryBytes;
  const totalBytes = encodedAdditions.reduce(
    (total, { value }) => total + (value.length > 4 ? value.length : 0),
    valueOffset,
  );
  const output = Buffer.alloc(totalBytes);
  tiff.copy(output);
  write32.call(output, newIfd, 4);
  write16.call(output, newCount, newIfd);

  const directoryEntries: Array<{
    tag: number;
    entry: Buffer;
    value?: Buffer;
    offset?: number;
  }> = [
    ...entries.map((entry) => ({ tag: read16.call(entry, 0), entry })),
    ...encodedAdditions.map(({ tag, value }) => {
      const entry = Buffer.alloc(12);
      write16.call(entry, tag, 0);
      write16.call(entry, 2, 2); // TIFF ASCII
      write32.call(entry, value.length, 4);
      if (value.length <= 4) value.copy(entry, 8);
      else write32.call(entry, valueOffset, 8);
      const encoded = { tag, entry, value, offset: valueOffset };
      if (value.length > 4) valueOffset += value.length;
      return encoded;
    }),
  ].toSorted((left, right) => left.tag - right.tag);
  for (const [index, item] of directoryEntries.entries()) {
    item.entry.copy(output, newIfd + 2 + index * 12);
    if (item.value && item.value.length > 4 && item.offset !== undefined)
      item.value.copy(output, item.offset);
  }
  write32.call(output, read32.call(tiff, entriesEnd), newIfd + 2 + newCount * 12);
  return output;
}

export function renderXmp(metadata: DeliveryMetadata): string {
  const creator = metadata.creator
    ? `<dc:creator><rdf:Seq><rdf:li>${escapeXml(metadata.creator)}</rdf:li></rdf:Seq></dc:creator>`
    : "";
  const rights = metadata.copyright
    ? `<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.copyright)}</rdf:li></rdf:Alt></dc:rights>`
    : "";
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">${creator}${rights}</rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
