import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
export interface FixtureManifest {
  file: string;
  size: number;
  sha256: string;
  previews: { width: number; height: number; offset: number; length: number }[];
  exif: { DateTimeOriginal: string; OffsetTimeOriginal: string };
  raw: {
    width: number;
    height: number;
    compression: number;
    sonyRawFileType: number;
    defaultCrop: [number, number];
  };
  libraw: { as_shot_wb: number[] };
}
export async function readManifest(file = "a7c2.ARW"): Promise<FixtureManifest> {
  return JSON.parse(
    await readFile(resolve(process.cwd(), "fixtures", file.replace(/\.ARW$/, ".json")), "utf8"),
  );
}

export async function readRawManifests(): Promise<FixtureManifest[]> {
  const files = (await readdir(resolve(process.cwd(), "fixtures")))
    .filter((file) => file.endsWith(".ARW"))
    .toSorted();
  return Promise.all(files.map((file) => readManifest(file)));
}
