import sharp from "sharp";
import { indexEmbeddedJpegs, type EmbeddedJpeg } from "./embedded.js";
import { readExif } from "./exif.js";

export type PreviewProducer =
  | { readonly kind: "decoded-file" }
  | { readonly kind: "embedded-jpeg"; readonly range: EmbeddedJpeg };

export interface ImageProbe {
  readonly kind: "image" | "raw";
  readonly mediaType: string;
  readonly dimensions: { w: number; h: number };
  readonly frameCount: 1;
  readonly preview: PreviewProducer;
  readonly embedded: EmbeddedJpeg[];
  readonly copyExact: boolean;
}

export async function probeImage(path: string): Promise<ImageProbe | undefined> {
  const decoded = await probeDecodedFile(path);
  if (decoded) return decoded;
  try {
    const embedded = await indexEmbeddedJpegs(path);
    const range = chooseCullingPreview(embedded);
    if (!range) return undefined;
    const exif = await readExif(path);
    return {
      kind: "raw",
      mediaType: "image/x-raw",
      dimensions: exif.dimensions,
      frameCount: 1,
      preview: { kind: "embedded-jpeg", range },
      embedded,
      copyExact: false,
    };
  } catch {
    return undefined;
  }
}

async function probeDecodedFile(path: string): Promise<ImageProbe | undefined> {
  try {
    const metadata = await sharp(path, { animated: true, failOn: "error" }).metadata();
    const frameCount = metadata.pages ?? 1;
    if (!metadata.format || !metadata.width || !metadata.height || frameCount !== 1) {
      return undefined;
    }
    await sharp(path, { failOn: "error" }).stats();
    return {
      kind: "image",
      mediaType: `image/${metadata.format}`,
      dimensions: { w: metadata.width, h: metadata.height },
      frameCount: 1,
      preview: { kind: "decoded-file" },
      embedded: [],
      copyExact: metadata.format === "jpeg",
    };
  } catch {
    return undefined;
  }
}

function chooseCullingPreview(previews: EmbeddedJpeg[]): EmbeddedJpeg | undefined {
  return (
    previews.find((preview) => preview.width === 1616 && preview.height === 1080) ??
    previews
      .filter((preview) => Math.max(preview.width, preview.height) <= 1616)
      .toSorted((left, right) => right.width * right.height - left.width * left.height)[0]
  );
}
