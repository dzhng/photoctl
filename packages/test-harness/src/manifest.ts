import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export interface FixtureManifest {
  file: string;
  size: number;
  sha256: string;
  previews: { width: number; height: number; offset: number; length: number }[];
  exif: { DateTimeOriginal: string; OffsetTimeOriginal: string };
}
export async function readManifest(): Promise<FixtureManifest> {
  return JSON.parse(await readFile(resolve(process.cwd(), "fixtures/a7c2.json"), "utf8"));
}
