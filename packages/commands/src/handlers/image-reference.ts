import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PhotoctlError } from "@photoctl/protocol";
import type { SentImage } from "@photoctl/providers";
import sharp from "sharp";

export async function readImageReference(
  value: string | undefined,
  cwd: string,
): Promise<SentImage | undefined> {
  if (value === undefined) return undefined;
  const path = resolve(cwd, value);
  try {
    const { data, info } = await sharp(await readFile(path), { failOn: "error" })
      .rotate()
      .png()
      .toBuffer({ resolveWithObject: true });
    return { png: data, w: info.width, h: info.height };
  } catch (error) {
    throw new PhotoctlError("usage", `Could not read --ref image: ${path}`, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
