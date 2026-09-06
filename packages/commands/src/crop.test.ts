import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { cropDataSchema, showDataSchema } from "@photoctl/protocol";
import {
  commitCanvasExpansion,
  prepareCanvasExpansion,
  readActiveDevelopState,
  loadLogicalFrame,
} from "@photoctl/render";
import { prepareReferenceArtifact } from "../../render/src/fill/reference.js";
import { dispatch } from "./dispatch.js";

test("auto crop reports progress while photographic evaluation is pending", async () => {
  const fixture = await createFixture(12);
  const query = fixture.handle.query;
  let pending = false;
  let reports = 0;
  let release: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    fixture.handle.query = (async (...args: Parameters<typeof query>) => {
      if (!pending && args[0].includes("FROM node_executions")) {
        pending = true;
        await new Promise<void>((resolve, reject) => {
          release = resolve;
          timer = setTimeout(
            () => reject(new Error("No progress during photographic evaluation")),
            6_000,
          );
        });
      }
      return await query(...args);
    }) as typeof query;
    const result = await dispatch(
      {
        verb: "crop",
        args: [fixture.id, "--auto"],
        cwd: fixture.directory,
        env: {
          noDaemon: true,
          cacheRoot: join(fixture.directory, "cache"),
          volumeMap: `${fixture.directory}=crop-fixture:online`,
        },
      },
      {
        version: "test",
        library: fixture.handle,
        emit: (event) => {
          if (event.event === "progress" && event.done === 0 && ++reports === 2) release?.();
        },
      },
    );
    expect(result).toMatchObject({ ok: true });
    expect(reports).toBeGreaterThanOrEqual(2);
    expect((await fixture.state()).develop.straighten_deg).toBeCloseTo(-12, 0);
  } finally {
    clearTimeout(timer);
    release?.();
    fixture.handle.query = query;
    await fixture.close();
  }
}, 10_000);

test("crop abstains on blank photographic output despite strong vector markup and still applies explicit aspect", async () => {
  const fixture = await createFixture(null);
  try {
    const { id, command, state } = fixture;
    await command("markup", [
      "add",
      id,
      "--json",
      JSON.stringify({ type: "line", from: [2, 40], to: [300, 180], width: 5, color: "#ffffff" }),
    ]);
    const before = await state();
    const result = cropDataSchema.parse((await command("crop", [id, "--auto"])).data);
    expect(result.auto).toEqual({ detected: false, correction_deg: null });
    expect((await state()).revisionId).toBe(before.revisionId);
    expect(result.render_hash).toBe(before.renderHash);
    const aspect = cropDataSchema.parse(
      (await command("crop", [id, "--auto", "--aspect", "1:1"])).data,
    );
    expect(aspect.auto).toEqual(result.auto);
    expect((await state()).develop).toEqual({ aspect_ratio: "1:1" });
    expect((await state()).revisionId).not.toBe(before.revisionId);
  } finally {
    await fixture.close();
  }
});

test("crop composes a residual with manual straighten, then repeated level detection is a revision no-op", async () => {
  const fixture = await createFixture(-17);
  try {
    const { id, command, state } = fixture;
    const manual = cropDataSchema.parse((await command("crop", [id, "--straighten", "8"])).data);
    expect(manual.auto).toBeNull();
    const detected = cropDataSchema.parse((await command("crop", [id, "--auto"])).data);
    expect(detected.auto?.detected).toBe(true);
    expect(detected.auto?.correction_deg).toBeCloseTo(9, 0);
    expect((await state()).develop.straighten_deg).toBeCloseTo(17, 0);
    const before = await state();
    const repeated = cropDataSchema.parse((await command("crop", [id, "--auto"])).data);
    expect(repeated.auto).toEqual({ detected: true, correction_deg: 0 });
    expect(repeated.render_hash).toBe(before.renderHash);
    expect((await state()).revisionId).toBe(before.revisionId);
    await command("undo", [id]);
    expect((await state()).develop).toEqual({ straighten_deg: 8 });
  } finally {
    await fixture.close();
  }
});

test("crop uses the quarter-turned photographic view and the pinned offline source", async () => {
  const fixture = await createFixture(-78, 240, 320);
  try {
    const { id, command, state, source } = fixture;
    await command("develop", [id, "--set", "rotate=90"]);
    await rename(source, `${source}.offline`);
    const response = await command("crop", [id, "--auto", "--aspect", "4:3"]);
    expect(response.warnings).toContainEqual(
      expect.objectContaining({ code: "source_offline", id }),
    );
    const result = cropDataSchema.parse(response.data);
    expect(result.auto?.correction_deg).toBeCloseTo(-12, 0);
    expect((await state()).develop).toMatchObject({ rotate: 90, aspect_ratio: "4:3" });
    expect((await state()).develop.straighten_deg).toBeCloseTo(-12, 0);
    const preview = showDataSchema.parse(
      (await command("show", [id, "--preview-size", "native"])).data,
    );
    expect(preview.preview).toBeTruthy();
  } finally {
    await fixture.close();
  }
});

test("auto rotates the visible expanded canvas without reactivating its consumed crop", async () => {
  const fixture = await createFixture(12);
  try {
    const { id, handle, command, state } = fixture;
    await command("develop", [id, "--set", 'crop={"x":40,"y":20,"w":240,"h":180}']);
    const prepared = await prepareCanvasExpansion(handle, {
      photoId: id,
      padding: 60,
      limits: { maxOutputEdge: 4096, maxOutputPixels: 16_000_000 },
    });
    const { w, h } = prepared.frame.raster;
    const pixels = Buffer.alloc(w * h * 3);
    const [a, b, c, d, e, f] = prepared.frame.rasterToBase;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const xx = a * x + c * y + e;
        const yy = b * x + d * y + f;
        pixels.set(
          yy < 240 * 0.42 + Math.tan((12 * Math.PI) / 180) * (xx - 160)
            ? [90, 165, 225]
            : [45, 75, 30],
          (y * w + x) * 3,
        );
      }
    const pinned = await prepareReferenceArtifact(handle.path, {
      w,
      h,
      png: await sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
        .png()
        .toBuffer(),
    });
    await commitCanvasExpansion(handle, handle.path, {
      prepared,
      artifacts: [pinned.artifact, pinned.encodedArtifact],
      nodes: [pinned.node],
      content: { localKey: pinned.node.localKey },
    });
    const before = await state();
    const result = cropDataSchema.parse((await command("crop", [id, "--auto"])).data);
    expect(result.auto?.correction_deg).toBeCloseTo(-12, 0);
    const after = await state();
    expect(after.develop.crop).toEqual({ x: 40, y: 20, w: 240, h: 180 });
    const frame = await loadLogicalFrame(handle, id, after.pixelOutputNodeId);
    expect(frame.raster.w).toBeGreaterThan(240);
    expect(frame.raster.h).toBeGreaterThan(180);
    await command("undo", [id]);
    expect((await state()).renderHash).toBe(before.renderHash);
  } finally {
    await fixture.close();
  }
});

test("crop refuses to commit an estimate when another edit wins after the photographic snapshot", async () => {
  const fixture = await createFixture(12);
  try {
    const { id, handle, command, response, state } = fixture;
    await state();
    const query = handle.query;
    let raced = false;
    // Delay the real database boundary while another real public writer wins.
    // No render/state collaborators are mocked; the assertion is the preserved edit.
    handle.query = (async (...args: Parameters<typeof query>) => {
      if (!raced && args[0].includes("FROM node_executions")) {
        raced = true;
        await command("develop", [id, "--set", "exposure=1"]);
      }
      return await query(...args);
    }) as typeof query;
    expect(await response("crop", [id, "--auto"])).toMatchObject({
      ok: false,
      code: "library_locked",
      data: { reason: "revision_conflict" },
    });
    expect((await state()).develop).toEqual({ exposure: 1 });
  } finally {
    await fixture.close();
  }
});

test("crop rejects malformed or contradictory operations before opening a library", async () => {
  await Promise.all(
    [
      [],
      ["id"],
      ["id", "other", "--auto"],
      ["id", "--auto", "--straighten", "2"],
      ["id", "--straighten", "46"],
      ["id", "--straighten", " "],
      ["id", "--aspect", "0:3"],
      ["id", "--auto", "--unknown"],
      ["id", "--auto", "--auto"],
    ].map(async (args) => {
      expect(
        await dispatch(
          {
            verb: "crop",
            args,
            cwd: "/",
            env: { noDaemon: true, libraryPath: "/nonexistent-crop-library" },
          },
          { version: "test" },
        ),
      ).toMatchObject({ ok: false, code: "usage" });
    }),
  );
});

test("conflicting photographic lines leave the revision and straighten untouched", async () => {
  const fixture = await createFixture("conflicting");
  try {
    const { id, state, command } = fixture;
    const before = await state();
    expect(cropDataSchema.parse((await command("crop", [id, "--auto"])).data).auto).toEqual({
      detected: false,
      correction_deg: null,
    });
    expect((await state()).revisionId).toBe(before.revisionId);
    expect((await state()).develop).toEqual(before.develop);
  } finally {
    await fixture.close();
  }
});

test("auto bounds large odd-sized photographic rasters without changing their line direction", async () => {
  const fixture = await createFixture(29, 1099, 577);
  try {
    const result = cropDataSchema.parse(
      (await fixture.command("crop", [fixture.id, "--auto"])).data,
    );
    expect(result.auto?.correction_deg).toBeCloseTo(-29, 0);
  } finally {
    await fixture.close();
  }
});

async function createFixture(angle: number | null | "conflicting", width = 320, height = 240) {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-crop-command-"));
  const { handle } = await initializeLibrary(join(directory, "library"));
  const source = join(directory, "scene.png");
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const above =
        typeof angle === "number" &&
        y < height * 0.42 + Math.tan((angle * Math.PI) / 180) * (x - width / 2);
      const crossing =
        angle === "conflicting" &&
        [-0.25, 0.25].some((slope) => Math.abs(y - height / 2 - slope * (x - width / 2)) < 1.5);
      pixels.set(
        crossing ? [220, 220, 220] : above ? [90, 165, 225] : [45, 75, 30],
        (y * width + x) * 3,
      );
    }
  await sharp(pixels, { raw: { width, height, channels: 3 } })
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
          volumeMap: `${directory}=crop-fixture:online`,
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
    handle,
    directory,
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
