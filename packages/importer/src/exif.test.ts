import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { formatShotInstant, readExif, shotInstant } from "./exif.js";

const execFileAsync = promisify(execFile);

describe("shotInstant", () => {
  test("stores the UTC instant and preserves the camera offset", () => {
    const shot = shotInstant("2023:10:02 18:18:37", "+02:00");

    expect(shot.shotAt.toISOString()).toBe("2023-10-02T16:18:37.000Z");
    expect(shot.shotOffsetMin).toBe(120);
    expect(formatShotInstant(shot.shotAt, shot.shotOffsetMin)).toBe("2023-10-02T18:18:37+02:00");
  });

  test("accepts the ISO-8601 offset boundary and rejects values beyond it", () => {
    expect(shotInstant("2023:10:02 18:18:37", "+14:00").shotOffsetMin).toBe(840);
    expect(shotInstant("2023:10:02 18:18:37", "-14:00").shotOffsetMin).toBe(-840);
    expect(() => shotInstant("2023:10:02 18:18:37", "+14:01")).toThrow("Invalid EXIF shot offset");
    expect(() => shotInstant("2023:10:02 18:18:37", "-15:00")).toThrow("Invalid EXIF shot offset");
  });
});

describe("readExif", () => {
  test("reads the fixture metadata without reviving its wall-clock time", async () => {
    const metadata = await readExif(resolve("fixtures/a7c2.ARW"));

    expect(metadata).toEqual({
      dimensions: { w: 7008, h: 4672 },
      orientation: 1,
      camera: { make: "SONY", model: "ILCE-7CM2", lens: "FE 24-70mm F4 ZA OSS" },
      exposure: { shutter: "1/100", f: 7.1, iso: 100, focal_mm: 24, wb: "auto" },
      shotAt: new Date("2023-10-02T16:18:37.000Z"),
      shotOffsetMin: 120,
    });
  });

  test("is independent of the process timezone", async () => {
    const [losAngeles, tokyo] = await Promise.all([
      readShotInTimezone("America/Los_Angeles"),
      readShotInTimezone("Asia/Tokyo"),
    ]);
    expect([losAngeles, tokyo]).toEqual([
      ["2023-10-02T18:18:37+02:00", "2023-10-02T16:18:37.000Z"],
      ["2023-10-02T18:18:37+02:00", "2023-10-02T16:18:37.000Z"],
    ]);
  });
});

async function readShotInTimezone(timezone: string): Promise<string[]> {
  const moduleUrl = pathToFileURL(resolve("packages/importer/src/exif.ts")).href;
  const fixture = resolve("fixtures/a7c2.ARW");
  const script = `
    import { formatShotInstant, readExif } from ${JSON.stringify(moduleUrl)};
    const metadata = await readExif(${JSON.stringify(fixture)});
    console.log(JSON.stringify([
      formatShotInstant(metadata.shotAt, metadata.shotOffsetMin),
      metadata.shotAt.toISOString(),
    ]));
  `;
  const { stdout } = await execFileAsync(
    "node",
    ["--experimental-strip-types", "--input-type=module", "--eval", script],
    { env: { ...process.env, TZ: timezone } },
  );
  return JSON.parse(stdout) as string[];
}
