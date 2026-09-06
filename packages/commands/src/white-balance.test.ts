/* eslint-disable no-await-in-loop -- Sequential commands inspect the same document revision. */
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { readActiveDevelopState } from "@photoctl/render";
import { readArtifactLinear } from "../../render/src/artifacts/publication.js";
import { whiteBalanceDataSchema } from "@photoctl/protocol";
import { dispatch } from "./dispatch.js";

test("white-balance eyedropper stores a neutral correction and repeats without another revision", async () => {
  const fixture = await createFixture([125, 130, 135]);
  const { directory, handle, command, id } = fixture;
  try {
    const fit = whiteBalanceDataSchema.parse(
      (await command("white_balance", [id, "--point", "0,0"])).data,
    );
    expect(fit.limited).toBe(false);
    expect(fit.residual).toBeLessThan(1e-6);
    const linear = join(directory, "neutral.tif");
    await command("render", [id, "--linear", "--to", linear]);
    const corrected = (await readArtifactLinear(linear)).data;
    expect(Math.max(...corrected) - Math.min(...corrected)).toBeLessThan(1e-6);
    const first = await readActiveDevelopState(handle, { photoId: id, orientation: 1 });
    expect(first.develop.white_balance?.temp_offset_k).toBeGreaterThan(0);
    await command("white_balance", [id, "--point", "0,0"]);
    expect((await readActiveDevelopState(handle, { photoId: id, orientation: 1 })).revisionId).toBe(
      first.revisionId,
    );
    await command("undo", [id]);
    expect((await readActiveDevelopState(handle, { photoId: id, orientation: 1 })).develop).toEqual(
      {},
    );
  } finally {
    await fixture.close();
  }
});

test("sampling excludes user grade and markup and maps normalized base coordinates while offline", async () => {
  const fixture = await createFixture([125, 130, 135, 135, 130, 125], 80, 40);
  const { id, command, source, state } = fixture;
  try {
    const bytes = await readFile(source);
    const baseline = whiteBalanceDataSchema.parse(
      (await command("white_balance", [id, "--region", "0,0,40,40"])).data,
    );
    await command("develop", [
      id,
      "--set",
      "exposure=1",
      "--set",
      "rotate=90",
      "--set",
      'crop={"x":0,"y":0,"w":60,"h":40}',
      "--set",
      "white_balance.tint=60",
    ]);
    await command("markup", [
      "add",
      id,
      "--json",
      JSON.stringify({ type: "line", from: [0, 20], to: [80, 20], width: 20, color: "#ff0000" }),
    ]);
    const online = whiteBalanceDataSchema.parse(
      (await command("white_balance", [id, "--region", "0,0,0.5,1", "--norm"])).data,
    );
    expect(online.white_balance).toEqual(baseline.white_balance);
    expect(online.sample).toEqual(baseline.sample);
    expect((await state()).develop).toMatchObject({
      exposure: 1,
      rotate: 90,
      crop: { x: 0, y: 0, w: 60, h: 40 },
    });
    expect(await readFile(source)).toEqual(bytes);
    await rename(source, `${source}.offline`);
    const offline = await command("white_balance", [id, "--point", "0.1,0.5", "--norm"]);
    expect(offline.warnings).toContainEqual(
      expect.objectContaining({ code: "source_offline", id }),
    );
    const sampled = whiteBalanceDataSchema.parse(offline.data);
    expect(sampled.white_balance.temp_offset_k).toBeGreaterThan(0);
    expect(sampled.residual).toBeLessThan(1e-6);
  } finally {
    await fixture.close();
  }
});

test("black, outside, and malformed samples leave the snapped document unchanged", async () => {
  const fixture = await createFixture([0, 0, 0], 4, 3);
  try {
    const before = await fixture.state();
    for (const args of [
      ["--point", "0,0"],
      ["--point", "4,0"],
      ["--point", "1,0", "--norm"],
      ["--region", "0,0,5,2"],
      ["--region", "0,0,0.1,0.1"],
      ["--point", "NaN,0"],
      ["--point", ",0"],
      ["--point", "0,0", "--region", "0,0,1,1"],
      ["--point", "0,0", "--unknown"],
    ]) {
      expect(await fixture.response("white_balance", [fixture.id, ...args])).toMatchObject({
        ok: false,
        code: "usage",
      });
      expect((await fixture.state()).revisionId).toBe(before.revisionId);
      expect((await fixture.state()).develop).toEqual(before.develop);
    }
  } finally {
    await fixture.close();
  }
});

test("portrait orientation and reduced offline pixels keep the oriented base sample", async () => {
  const colors = Array.from({ length: 1800 }, (_, x) => [
    100 + (x % 71),
    115 + (x % 43),
    110 + (x % 59),
  ]).flat();
  const fixture = await createFixture(colors, 1800, 12, 6);
  try {
    const { id, command, source } = fixture;
    const online = whiteBalanceDataSchema.parse(
      (await command("white_balance", [id, "--point", "0.5,0.8", "--norm"])).data,
    );
    expect(online.sample.raster).toEqual({ w: 12, h: 1800 });
    await command("undo", [id]);
    await rename(source, `${source}.offline`);
    const linear = join(fixture.directory, "offline-reference.tif");
    await command("render", [id, "--linear", "--to", linear]);
    const reference = await readArtifactLinear(linear);
    // The authored EXIF6 input is already oriented here; the 80% base-height
    // click selects row floor(.8 * 1616) in this independently read output.
    const offset = (1292 * reference.w + Math.floor(reference.w / 2)) * 3;
    const offline = whiteBalanceDataSchema.parse(
      (await command("white_balance", [id, "--point", "0.5,0.8", "--norm"])).data,
    );
    expect(offline.sample.raster.h).toBe(1616);
    expect(offline.sample).toMatchObject({ point: [6, 1440] });
    expect(offline.sample.mean_rgb).toEqual(
      Array.from(reference.data.subarray(offset, offset + 3)),
    );
    expect(offline.sample.pixels).toBe(1);
  } finally {
    await fixture.close();
  }
});

test("fractional regions include their near centers and exclude their far centers", async () => {
  const fixture = await createFixture([125, 130, 135, 135, 130, 125], 2, 1);
  try {
    const { id, command } = fixture;
    const near = whiteBalanceDataSchema.parse(
      (await command("white_balance", [id, "--point", "-0,0"])).data,
    );
    const far = whiteBalanceDataSchema.parse(
      (await command("white_balance", [id, "--point", "1,0"])).data,
    );
    const first = whiteBalanceDataSchema.parse(
      (await command("white_balance", [id, "--region", "0.5,0,1,1"])).data,
    );
    const second = whiteBalanceDataSchema.parse(
      (await command("white_balance", [id, "--region", "0.500001,0,1,1"])).data,
    );
    expect(first.sample.mean_rgb).toEqual(near.sample.mean_rgb);
    expect(second.sample.mean_rgb).toEqual(far.sample.mean_rgb);
    expect(first.sample.pixels).toBe(1);
    expect(second.sample.pixels).toBe(1);
    expect(first.white_balance.temp_offset_k).toBeGreaterThan(0);
    expect(second.white_balance.temp_offset_k).toBeLessThan(0);
  } finally {
    await fixture.close();
  }
});

test("an out-of-range neutral reports its remaining color without widening controls", async () => {
  const fixture = await createFixture([220, 100, 70]);
  try {
    const fit = whiteBalanceDataSchema.parse(
      (await fixture.command("white_balance", [fixture.id, "--point", "0,0"])).data,
    );
    expect(fit.limited).toBe(true);
    expect(fit.residual).toBeGreaterThan(0.01);
    expect(Math.abs(fit.white_balance.temp_offset_k)).toBeLessThanOrEqual(1500);
    expect(Math.abs(fit.white_balance.tint)).toBeLessThanOrEqual(100);
    expect((await fixture.state()).develop.white_balance).toEqual(fit.white_balance);
  } finally {
    await fixture.close();
  }
});

test("a concurrent develop edit is not overwritten by a sampled stale snapshot", async () => {
  const fixture = await createFixture([125, 130, 135]);
  const query = fixture.handle.query;
  let injected = false;
  try {
    await fixture.state();
    fixture.handle.query = (async (...args: Parameters<typeof query>) => {
      if (!injected && args[0].includes("FROM node_executions")) {
        injected = true;
        await fixture.command("develop", [fixture.id, "--set", "exposure=1"]);
      }
      return await query(...args);
    }) as typeof query;
    expect(await fixture.response("white_balance", [fixture.id, "--point", "0,0"])).toMatchObject({
      ok: false,
      code: "library_locked",
      data: { reason: "revision_conflict" },
    });
    expect(injected).toBe(true);
    expect((await fixture.state()).develop).toEqual({ exposure: 1 });
  } finally {
    fixture.handle.query = query;
    await fixture.close();
  }
});

async function createFixture(colors: number[], width = 1, height = 1, orientation = 1) {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-white-balance-"));
  const { handle } = await initializeLibrary(join(directory, "library"));
  const source = join(directory, "patch.png");
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const start = Math.floor((x / width) * (colors.length / 3)) * 3;
      pixels.set(colors.slice(start, start + 3), (y * width + x) * 3);
    }
  await sharp(pixels, { raw: { width, height, channels: 3 } })
    .withMetadata({ orientation })
    .png()
    .toFile(source);
  const response = async (verb: string, args: string[]) =>
    await dispatch(
      {
        verb,
        args,
        cwd: directory,
        env: {
          noDaemon: true,
          cacheRoot: join(directory, "cache"),
          volumeMap: `${directory}=wb-fixture:online`,
        },
      },
      { version: "test", library: handle },
    );
  const command = async (verb: string, args: string[]) => {
    const result = await response(verb, args);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    return result;
  };
  const id = ((await command("import", [source, "--link"])).data as { ids: string[] }).ids[0]!;
  return {
    id,
    directory,
    handle,
    source,
    command,
    response,
    state: async () => await readActiveDevelopState(handle, { photoId: id, orientation: 1 }),
    close: async () => {
      await handle.close();
      await rm(directory, { recursive: true });
    },
  };
}
