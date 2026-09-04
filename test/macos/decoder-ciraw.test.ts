import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { CirawDecoder, type ImageSource } from "@photoctl/render";

const repository = resolve(import.meta.dirname, "../..");
const helper = join(repository, "helpers/mac/.build/debug/photoctl-mac");
const fixture = join(repository, "fixtures/a7c2.ARW");

test("CIRAW decodes the committed camera file deterministically without presentation edits", async () => {
  const first = join(tmpdir(), `photoctl-ciraw-${process.pid}-first.f32`);
  try {
    const probe = run(["probe", fixture]);
    expect(probe).toMatchObject({ supported: true, nativeWidth: 7008, nativeHeight: 4672 });
    expect(probe.supportedDecoderVersions).not.toEqual(["None"]);

    const firstResult = run(["decode", fixture, "--scale", "0.25", "--output", first]);
    const source: ImageSource = {
      kind: "online-file",
      path: fixture,
      mediaType: "image/x-raw",
      w: 7008,
      h: 4672,
    };
    const image = await new CirawDecoder(helper).decode(source, { scale: 0.25 });
    expect(firstResult).toMatchObject({
      width: 1752,
      height: 1168,
      channels: 3,
      space: "scene-linear-rec2020",
      orientationApplied: true,
      wireFormat: "rgb-f32le",
    });
    expect(image).toMatchObject({
      w: 1752,
      h: 1168,
      space: "scene-linear-rec2020",
      orientationApplied: true,
    });
    expect(image.data.every(Number.isFinite)).toBe(true);
    expect(image.data.some((sample) => sample > 0.01)).toBe(true);
    const firstBytes = await readFile(first);
    const secondBytes = Buffer.from(
      image.data.buffer,
      image.data.byteOffset,
      image.data.byteLength,
    );
    expect(firstBytes.byteLength).toBe(1752 * 1168 * 3 * Float32Array.BYTES_PER_ELEMENT);
    expect(hash(firstBytes)).toBe(hash(secondBytes));
  } finally {
    await rm(first, { force: true });
  }
});

function run(args: string[]): Record<string, unknown> {
  const result = spawnSync(helper, args, { cwd: repository, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
