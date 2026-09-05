import sharp from "sharp";

export const AGENT_PREVIEW_FACTS = {
  dimensions: { w: 1_920, h: 1_280 },
  person: {
    bbox: [800, 400, 192, 256] as [number, number, number, number],
    anchor: [896, 528] as [number, number],
    detailA: [824, 424] as [number, number],
    detailB: [840, 424] as [number, number],
  },
  region: [736, 336, 320, 384] as [number, number, number, number],
  protectedPoint: [760, 520] as [number, number],
} as const;

/** Writes an asymmetric, high-frequency portrait surrogate with stable pixel facts. */
export async function writeAgentPreviewFixture(path: string): Promise<void> {
  const { w, h } = AGENT_PREVIEW_FACTS.dimensions;
  const [personX, personY, personW, personH] = AGENT_PREVIEW_FACTS.person.bbox;
  const pixels = Buffer.allocUnsafe(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const offset = (y * w + x) * 3;
      const inPerson =
        x >= personX && x < personX + personW && y >= personY && y < personY + personH;
      if (inPerson) {
        const light = (Math.floor((x - personX) / 16) + Math.floor((y - personY) / 16)) % 2;
        pixels[offset] = light ? 178 : 28;
        pixels[offset + 1] = light ? 152 : 36;
        pixels[offset + 2] = light ? 92 : 58;
      } else {
        pixels[offset] = 30 + Math.floor((x / (w - 1)) * 50);
        pixels[offset + 1] = 42 + Math.floor((y / (h - 1)) * 45);
        pixels[offset + 2] = 68 + ((Math.floor(x / 24) + Math.floor(y / 24)) % 2) * 14;
      }
    }
  }
  await sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toFile(path);
}
