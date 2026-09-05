import { initializeLibrary } from "@photoctl/library";
import {
  prepareCanvasExpansion,
  commitCanvasExpansion,
  loadActiveDocument,
  readArtifactLinear,
  artifactPath,
  undoRevision,
} from "@photoctl/render";
import { showDataSchema, segmentDataSchema } from "@photoctl/protocol";
import type { StructuredModelAdapter } from "@photoctl/providers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";
import { prepareReferenceArtifact } from "../../render/src/fill/reference.js";

async function createCanvasFixture(w = 16, h = 12) {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-canvas-"));
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  try {
    const source = join(parent, "source.png");
    const pixels = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        pixels[(y * w + x) * 3] = Math.round((x * 192) / w);
        pixels[(y * w + x) * 3 + 1] = Math.round((y * 192) / h);
        pixels[(y * w + x) * 3 + 2] = 80;
      }
    await sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
      .png()
      .toFile(source);
    const response = async (verb: string, args: string[]) => {
      const result = await dispatch(
        {
          verb,
          args,
          cwd: parent,
          env: {
            noDaemon: true,
            cacheRoot: join(parent, "cache"),
            volumeMap: `${parent}=fixture:online`,
          },
        },
        { version: "test", library: handle },
      );
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
      if (!result.ok) throw new Error(JSON.stringify(result));
      return result;
    };
    const command = async (verb: string, args: string[]) => {
      const result = await response(verb, args);
      return "data" in result ? result.data : result;
    };
    const id = ((await command("import", [source, "--link"])) as { ids: string[] }).ids[0]!;
    const currentPixels = async () => {
      const document = (await loadActiveDocument(handle, id))!;
      const execution = (
        await handle.query<{ output_artifact_hash: string }>(
          "SELECT output_artifact_hash FROM node_executions WHERE photo_id = $1 AND node_id = $2 ORDER BY created_at DESC LIMIT 1",
          [id, document.roots.output],
        )
      ).rows[0]!;
      return await readArtifactLinear(
        artifactPath(handle.path, execution.output_artifact_hash, "tif"),
        execution.output_artifact_hash,
      );
    };
    const author = async (padding: number, color: string) => {
      const prepared = await prepareCanvasExpansion(handle, {
        photoId: id,
        padding,
        limits: { maxOutputEdge: 16_384, maxOutputPixels: 64_000_000 },
      });
      const { w: width, h: height } = prepared.frame.raster;
      const pinned = await prepareReferenceArtifact(handle.path, {
        w: width,
        h: height,
        png: await sharp({
          create: { width, height, channels: 3, background: color },
        })
          .png()
          .toBuffer(),
      });
      const committed = await commitCanvasExpansion(handle, handle.path, {
        prepared,
        artifacts: [pinned.artifact, pinned.encodedArtifact],
        content: { localKey: pinned.node.localKey },
        nodes: [pinned.node],
      });
      if (!committed.changed) throw new Error("Expected expansion");
      return { ...committed, prepared, pinned };
    };
    return {
      parent,
      handle,
      source,
      id,
      command,
      response,
      currentPixels,
      author,
      close: async () => {
        await handle.close();
        await rm(parent, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await handle.close();
    await rm(parent, { recursive: true, force: true });
    throw error;
  }
}

test("canvas publication rejects mismatched intrinsic pixels without activating a border", async () => {
  const fixture = await createCanvasFixture();
  const { handle, id } = fixture;
  try {
    const prepared = await prepareCanvasExpansion(handle, {
      photoId: id,
      padding: 2,
      limits: { maxOutputEdge: 16_384, maxOutputPixels: 64_000_000 },
    });
    const wrong = await prepareReferenceArtifact(handle.path, {
      w: 3,
      h: 2,
      png: await sharp({
        create: { width: 3, height: 2, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
    });
    await expect(
      commitCanvasExpansion(handle, handle.path, {
        prepared,
        artifacts: [wrong.artifact, wrong.encodedArtifact],
        nodes: [wrong.node],
        content: { localKey: wrong.node.localKey },
      }),
    ).rejects.toThrow(/intrinsic raster/i);
    expect(await loadActiveDocument(handle, id)).toBeNull();
  } finally {
    await fixture.close();
  }
});

test("a border transform moves its full intrinsic pixels and extent without moving the original interior", async () => {
  const fixture = await createCanvasFixture();
  const { id, command, author, currentPixels } = fixture;
  try {
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    await command("show", [id, "--preview-size", "native"]);
    const interior = await currentPixels();
    const border = await author(2, "red");
    await command("layer", ["transform", id, border.layerId, "--dx", "4", "--anchor", "0,0"]);
    const moved = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    expect(moved.preview_info.actual).toMatchObject({ w: 12, h: 8 });
    expect(moved.preview_info.base_to_view).toEqual({ a: 1, b: 0, c: 0, d: 1, e: -4, f: -1 });
    const pixels = await currentPixels();
    // Original cell (4,3) stays fixed; the far translated ring at (15,4) survives.
    expect(pixels.data.slice(2 * 12 * 3, 2 * 12 * 3 + 3)).toEqual(interior.data.slice(0, 3));
    expect(pixels.data[(3 * 12 + 11) * 3]).toBeGreaterThan(0.5);
    // Moving the border's hole does not reveal the originally excluded source beneath it.
    expect(pixels.data.slice((3 * 12 + 8) * 3, (3 * 12 + 8) * 3 + 3)).toEqual(new Float32Array(3));
  } finally {
    await fixture.close();
  }
});

test("a later expansion preserves the complete visible input after an earlier border moves", async () => {
  const fixture = await createCanvasFixture();
  const { id, command, author, currentPixels } = fixture;
  try {
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    const a = await author(2, "red");
    await command("layer", ["transform", id, a.layerId, "--dx", "4", "--anchor", "0,0"]);
    await command("show", [id, "--preview-size", "native"]);
    const input = await currentPixels();
    expect({ w: input.w, h: input.h }).toEqual({ w: 12, h: 8 });
    await author(1, "blue");
    const shown = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    expect(shown.preview_info.actual).toMatchObject({ w: 14, h: 10 });
    const expanded = await currentPixels();
    for (let y = 0; y < input.h; y++) {
      expect(expanded.data.slice(((y + 1) * 14 + 1) * 3, ((y + 1) * 14 + 13) * 3)).toEqual(
        input.data.slice(y * 12 * 3, (y + 1) * 12 * 3),
      );
    }
    await command("layer", ["transform", id, a.layerId, "--dx", "0", "--anchor", "0,0"]);
    const movedAgain = showDataSchema.parse(
      await command("show", [id, "--preview-size", "native"]),
    );
    expect(movedAgain.preview_info.actual).toEqual(shown.preview_info.actual);
    expect(movedAgain.preview_info.base_to_view).toEqual(shown.preview_info.base_to_view);
    const missing = await currentPixels();
    expect(missing.data.slice((4 * 14 + 12) * 3, (4 * 14 + 12) * 3 + 3)).toEqual(
      new Float32Array(3),
    );
    expect(missing.data.slice(0, 3)).toEqual(expanded.data.slice(0, 3));
    await command("layer", ["transform", id, a.layerId, "--dx", "4", "--anchor", "0,0"]);
    await command("show", [id, "--preview-size", "native"]);
    expect((await currentPixels()).data).toEqual(expanded.data);
  } finally {
    await fixture.close();
  }
});

test("coincident border copies preserve authored support until the final copy is cleared", async () => {
  const fixture = await createCanvasFixture();
  const { id, command, author, currentPixels } = fixture;
  try {
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    const a = await author(2, "red");
    await command("show", [id, "--preview-size", "native"]);
    const original = await currentPixels();
    await command("layer", ["duplicate", id, a.layerId]);
    await command("layer", ["remove", id, a.layerId]);
    const copied = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    expect(copied.preview_info.actual).toMatchObject({ w: 10, h: 8 });
    expect((await currentPixels()).data).toEqual(original.data);
    await command("layer", ["clear", id]);
    const cleared = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    expect(cleared.preview_info.actual).toMatchObject({ w: 6, h: 4 });
    const interior = await currentPixels();
    for (let y = 0; y < 4; y++)
      expect(interior.data.slice(y * 6 * 3, (y + 1) * 6 * 3)).toEqual(
        original.data.slice(((y + 2) * 10 + 2) * 3, ((y + 2) * 10 + 8) * 3),
      );
  } finally {
    await fixture.close();
  }
});

test("border reorder changes overlapping paint without changing the authored canvas or original interior", async () => {
  const fixture = await createCanvasFixture();
  const { id, command, author, currentPixels } = fixture;
  try {
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    const a = await author(2, "red");
    const b = await author(1, "blue");
    await command("layer", ["transform", id, b.layerId, "--dx", "1", "--anchor", "0,0"]);
    const back = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    expect(back.preview_info.actual).toMatchObject({ w: 12, h: 10 });
    expect(back.preview_info.base_to_view).toEqual({ a: 1, b: 0, c: 0, d: 1, e: -2, f: 0 });
    const blue = await currentPixels();
    // Base point (2,2) belongs to both rings; (4,3) remains original interior.
    const overlap = 2 * 12 * 3;
    const original = (3 * 12 + 2) * 3;
    expect(blue.data[overlap + 2]).toBeGreaterThan(0.5);
    await command("layer", ["reorder", id, a.layerId, "--front"]);
    const front = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    expect(front.preview_info.actual).toEqual(back.preview_info.actual);
    expect(front.preview_info.base_to_view).toEqual(back.preview_info.base_to_view);
    const red = await currentPixels();
    expect(red.data[overlap]).toBeGreaterThan(0.5);
    expect(red.data[overlap + 2]).toBeLessThan(0.1);
    expect(red.data.slice(original, original + 3)).toEqual(blue.data.slice(original, original + 3));
  } finally {
    await fixture.close();
  }
});

test("an arbitrary border rotation moves its ring and hole while original pixels stay fixed", async () => {
  const fixture = await createCanvasFixture();
  const { id, command, response, author, currentPixels } = fixture;
  try {
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    await command("show", [id, "--preview-size", "native"]);
    const original = await currentPixels();
    const a = await author(2, "red");
    await command("layer", ["transform", id, a.layerId, "--rotate", "30", "--anchor", "0,0"]);
    const result = await response("show", [id, "--preview-size", "native"]);
    const shown = showDataSchema.parse(result.data);
    // Rotated outer corners span [-2.77,9.90] × [1.87,13.80]; original support ends at x=10.
    expect(shown.preview_info.actual).toMatchObject({ w: 13, h: 13 });
    expect(shown.preview_info.base_to_view).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 3, f: -1 });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "canvas_uncovered", id }),
    );
    const rotated = await currentPixels();
    expect(rotated.data[(4 * 13 + 3) * 3]).toBeGreaterThan(0.5);
    expect(rotated.data.slice((7 * 13 + 6) * 3, (7 * 13 + 6) * 3 + 3)).toEqual(new Float32Array(3));
    expect(rotated.data.slice((2 * 13 + 7) * 3, (2 * 13 + 7) * 3 + 3)).toEqual(
      original.data.slice(0, 3),
    );
    await command("layer", ["transform", id, a.layerId, "--rotate", "0", "--anchor", "0,0"]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 10, h: 8 });
  } finally {
    await fixture.close();
  }
});

test("uncovered canvas status survives cached show and skipped export and ignores intentional border opacity", async () => {
  const fixture = await createCanvasFixture();
  const { id, command, response, author } = fixture;
  try {
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    const border = await author(2, "red");
    await command("layer", ["set", id, border.layerId, "--opacity", "0"]);
    expect((await response("show", [id, "--preview-size", "native"])).warnings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "canvas_uncovered" })]),
    );
    await command("layer", ["transform", id, border.layerId, "--dx", "4", "--anchor", "0,0"]);
    for (let i = 0; i < 2; i++) {
      expect((await response("show", [id, "--preview-size", "native"])).warnings).toContainEqual(
        expect.objectContaining({ code: "canvas_uncovered", id }),
      );
    }
    const exported = await response("export", [id, "--to", join(fixture.parent, "delivery")]);
    expect(exported.warnings).toContainEqual(
      expect.objectContaining({ code: "canvas_uncovered", id }),
    );
    const skipped = await response("export", [
      id,
      "--to",
      join(fixture.parent, "delivery"),
      "--on-collision",
      "skip",
    ]);
    expect(skipped).toMatchObject({ results: [expect.objectContaining({ id, skipped: true })] });
    expect(skipped.warnings).toContainEqual(
      expect.objectContaining({ code: "canvas_uncovered", id }),
    );
  } finally {
    await fixture.close();
  }
});

test("removing the last border retains an exterior crop and makes only unsupported coordinates black", async () => {
  const fixture = await createCanvasFixture();
  const { id, command, response, author, currentPixels } = fixture;
  try {
    await command("show", [id, "--preview-size", "native"]);
    const original = await currentPixels();
    const border = await author(2, "red");
    await command("develop", [id, "--set", 'crop={"x":-2,"y":3,"w":6,"h":4}']);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 6, h: 4 });
    await command("layer", ["remove", id, border.layerId]);
    const removed = await response("show", [id, "--preview-size", "native"]);
    expect(removed.warnings).toContainEqual(
      expect.objectContaining({ code: "canvas_uncovered", id }),
    );
    if (!("data" in removed)) throw new Error("Expected show data");
    expect(showDataSchema.parse(removed.data).preview_info.actual).toMatchObject({ w: 6, h: 4 });
    const pixels = await currentPixels();
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 6; x++) {
        const offset = (y * 6 + x) * 3;
        const sourceOffset = ((y + 3) * 16 + x - 2) * 3;
        expect(pixels.data.slice(offset, offset + 3)).toEqual(
          x < 2 ? new Float32Array(3) : original.data.slice(sourceOffset, sourceOffset + 3),
        );
      }
  } finally {
    await fixture.close();
  }
});

test("new original-only crops may be partly exterior but reject disjoint and unsafe enlargement before a revision", async () => {
  const fixture = await createCanvasFixture();
  const { id, handle, command } = fixture;
  try {
    await command("develop", [id, "--set", 'crop={"x":-2,"y":3,"w":6,"h":4}']);
    const view = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    expect(view.preview_info.actual).toMatchObject({ w: 6, h: 4 });
    const revision = (await loadActiveDocument(handle, id))!.revisionId;
    for (const crop of [
      { x: 100, y: 100, w: 6, h: 4 },
      { x: -2, y: 3, w: 1_000_000_000, h: 4 },
    ]) {
      const rejected = await dispatch(
        {
          verb: "develop",
          args: [id, "--set", `crop=${JSON.stringify(crop)}`],
          cwd: fixture.parent,
          env: { noDaemon: true },
        },
        { version: "test", library: handle },
      );
      expect(rejected).toMatchObject({ ok: false, code: "usage" });
      expect((await loadActiveDocument(handle, id))!.revisionId).toBe(revision);
    }
  } finally {
    await fixture.close();
  }
});

test("a new crop validates the visible intersection after its requested aspect constraint", async () => {
  const fixture = await createCanvasFixture();
  try {
    await fixture.command("develop", [fixture.id, "--set", 'crop={"x":0,"y":0,"w":4,"h":4}']);
    const revision = (await loadActiveDocument(fixture.handle, fixture.id))!.revisionId;
    const rejected = await dispatch(
      {
        verb: "develop",
        cwd: fixture.parent,
        args: [fixture.id, "--set", 'crop={"x":3,"y":0,"w":12,"h":4}', "--set", "aspect_ratio=1:1"],
        env: { noDaemon: true },
      },
      { version: "test", library: fixture.handle },
    );
    expect(rejected).toMatchObject({ ok: false, code: "usage" });
    expect((await loadActiveDocument(fixture.handle, fixture.id))!.revisionId).toBe(revision);
  } finally {
    await fixture.close();
  }
});

test("aspect activation restricts the authored canvas without reactivating its consumed crop", async () => {
  const fixture = await createCanvasFixture();
  try {
    await fixture.command("develop", [fixture.id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    await fixture.author(2, "red");
    await fixture.command("develop", [fixture.id, "--set", "aspect_ratio=1:1"]);
    const view = showDataSchema.parse(
      await fixture.command("show", [fixture.id, "--preview-size", "native"]),
    );
    expect(view.preview_info.actual).toMatchObject({ w: 8, h: 8 });
    await fixture.author(1, "blue");
    await fixture.command("develop", [fixture.id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    const cropOnly = showDataSchema.parse(
      await fixture.command("show", [fixture.id, "--preview-size", "native"]),
    );
    expect(cropOnly.preview_info.actual).toMatchObject({ w: 6, h: 4 });
    await fixture.command("develop", [fixture.id, "--set", "aspect_ratio=1:1"]);
    const combined = showDataSchema.parse(
      await fixture.command("show", [fixture.id, "--preview-size", "native"]),
    );
    expect(combined.preview_info.actual).toMatchObject({ w: 4, h: 4 });
    await fixture.command("develop", [fixture.id, "--unset", "aspect_ratio"]);
    const clearedAspect = showDataSchema.parse(
      await fixture.command("show", [fixture.id, "--preview-size", "native"]),
    );
    expect(clearedAspect.preview_info.actual).toMatchObject({ w: 6, h: 4 });
    await fixture.command("develop", [fixture.id, "--unset", "crop"]);
    const clearedBoth = showDataSchema.parse(
      await fixture.command("show", [fixture.id, "--preview-size", "native"]),
    );
    expect(clearedBoth.preview_info.actual).toMatchObject({ w: 10, h: 10 });
  } finally {
    await fixture.close();
  }
});

test("post-border aspect precedes the replaceable orientation tail and restores exact authored pixels", async () => {
  const fixture = await createCanvasFixture(1000, 800);
  const { id, command, author, currentPixels } = fixture;
  try {
    await command("develop", [
      id,
      "--set",
      'crop={"x":100,"y":200,"w":400,"h":200}',
      "--set",
      "rotate=90",
      "--set",
      "straighten_deg=10",
    ]);
    await author(20, "red");
    await command("show", [id, "--preview-size", "native"]);
    const authored = await currentPixels();
    await command("develop", [id, "--set", "aspect_ratio=2:1"]);
    const restricted = showDataSchema.parse(
      await command("show", [id, "--preview-size", "native"]),
    );
    expect(restricted.preview_info.actual).toMatchObject({ w: 175, h: 350 });
    const restrictedPixels = await currentPixels();
    await command("develop", [id, "--set", "straighten_deg=5"]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 146, h: 338 });
    await command("develop", [id, "--set", "rotate=180"]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 338, h: 146 });
    await command("develop", [id, "--set", "rotate=90", "--set", "straighten_deg=10"]);
    await command("show", [id, "--preview-size", "native"]);
    expect((await currentPixels()).data).toEqual(restrictedPixels.data);
    await command("develop", [id, "--unset", "aspect_ratio"]);
    await command("show", [id, "--preview-size", "native"]);
    expect((await currentPixels()).data).toEqual(authored.data);
  } finally {
    await fixture.close();
  }
}, 30_000);

test("new crop validation ignores a consumed aspect instead of refusing a visible intersection", async () => {
  const fixture = await createCanvasFixture();
  try {
    await fixture.command("develop", [
      fixture.id,
      "--set",
      'crop={"x":0,"y":0,"w":4,"h":4}',
      "--set",
      "aspect_ratio=1:1",
    ]);
    await fixture.author(2, "red");
    await fixture.command("develop", [fixture.id, "--set", 'crop={"x":5,"y":0,"w":12,"h":4}']);
    const view = showDataSchema.parse(
      await fixture.command("show", [fixture.id, "--preview-size", "native"]),
    );
    expect(view.preview_info.actual).toMatchObject({ w: 12, h: 4 });
  } finally {
    await fixture.close();
  }
});

test("auto-enhance and its undo inherit consumed geometry without reactivating restrictions", async () => {
  const fixture = await createCanvasFixture();
  const { id, handle, command } = fixture;
  try {
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    await fixture.author(2, "red");
    const before = (await loadActiveDocument(handle, id))!;
    const structured: StructuredModelAdapter = {
      id: "canvas-structured-fixture",
      version: "1",
      ask: async <Value>(schema: { parse(value: unknown): Value }) => ({
        value: schema.parse({ contrast: 9 }),
        model: "fixture/structured",
        requestId: "canvas-auto",
        attempts: 1,
      }),
    };
    const automatic = await dispatch(
      {
        verb: "develop",
        args: [id, "--auto-enhance"],
        cwd: fixture.parent,
        env: {
          noDaemon: true,
          cacheRoot: join(fixture.parent, "cache"),
          volumeMap: `${fixture.parent}=fixture:online`,
        },
      },
      { version: "test", library: handle, develop: { structured } },
    );
    expect(automatic).toMatchObject({ ok: true });
    expect((await loadActiveDocument(handle, id))!.roots.geometry).toBe(before.roots.geometry);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 10, h: 8 });
    await command("develop", [id, "--undo-auto"]);
    const undone = (await loadActiveDocument(handle, id))!;
    expect(undone.roots.geometry).toBe(before.roots.geometry);
    expect(undone.metadata).toBeNull();
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 10, h: 8 });
  } finally {
    await fixture.close();
  }
});

test("preset overlays preserve consumed crop while copy and reset explicitly replace its intent", async () => {
  const fixture = await createCanvasFixture();
  const { id, command, handle } = fixture;
  try {
    const copySource = join(fixture.parent, "copy-source.png");
    await sharp({ create: { width: 16, height: 12, channels: 3, background: "#607080" } })
      .png()
      .toFile(copySource);
    const other = ((await command("import", [copySource, "--link"])) as { ids: string[] }).ids[0]!;
    await command("develop", [other, "--set", "contrast=9"]);
    await command("presets", ["save", "canvas-tone", "--from", other]);
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    const border = await fixture.author(2, "red");
    await command("develop", [id, "--preset", "canvas-tone"]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 10, h: 8 });
    await command("develop", [other, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    await command("develop", [id, "--copy-from", other]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 6, h: 4 });
    const copied = (await loadActiveDocument(handle, id))!.revisionId;
    await command("develop", [id, "--copy-from", other]);
    expect((await loadActiveDocument(handle, id))!.revisionId).toBe(copied);
    await command("develop", [id, "--reset"]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 10, h: 8 });
    await command("layer", ["remove", id, border.layerId]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 16, h: 12 });
  } finally {
    await fixture.close();
  }
});

test("revision undo restores border pixels and consumed geometry after removal and a later crop", async () => {
  const fixture = await createCanvasFixture();
  const { id, handle, command, currentPixels } = fixture;
  try {
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    const border = await fixture.author(2, "red");
    await command("show", [id, "--preview-size", "native"]);
    const before = (await loadActiveDocument(handle, id))!;
    const pixels = await currentPixels();
    await command("layer", ["remove", id, border.layerId]);
    const removed = (await loadActiveDocument(handle, id))!;
    await undoRevision(handle, { photoId: id, expectedRevisionId: removed.revisionId });
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 10, h: 8 });
    expect((await currentPixels()).data).toEqual(pixels.data);
    expect((await loadActiveDocument(handle, id))!.roots.geometry).toBe(before.roots.geometry);
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    const cropped = (await loadActiveDocument(handle, id))!;
    await undoRevision(handle, { photoId: id, expectedRevisionId: cropped.revisionId });
    await command("show", [id, "--preview-size", "native"]);
    expect((await currentPixels()).data).toEqual(pixels.data);
    expect((await loadActiveDocument(handle, id))!.roots.geometry).toBe(before.roots.geometry);
    const exported = await fixture.response("export", [
      id,
      "--to",
      join(fixture.parent, "undone-delivery"),
    ]);
    expect(exported).toMatchObject({
      results: [expect.objectContaining({ id, w: 10, h: 8, render_hash: before.renderHash })],
    });
  } finally {
    await fixture.close();
  }
});

test("a deterministic border expands the cropped rotated photograph and survives ordinary layer edits", async () => {
  const fixture = await createCanvasFixture();
  const { handle, id, command, currentPixels } = fixture;
  try {
    const untouched = await prepareCanvasExpansion(handle, {
      photoId: id,
      aspect: [4, 3],
      limits: { maxOutputEdge: 16_384, maxOutputPixels: 64_000_000 },
    });
    expect(untouched.changed).toBe(false);
    expect(untouched.expectedRevisionId).toBeNull();
    expect(
      (await handle.query("SELECT 1 FROM document_revisions WHERE photo_id = $1", [id])).rows,
    ).toHaveLength(0);
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}', "--set", "rotate=90"]);
    const before = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    expect(before.preview_info.actual).toMatchObject({ w: 4, h: 6 });
    const beforePixels = await currentPixels();

    const prepared = await prepareCanvasExpansion(handle, {
      photoId: id,
      padding: 2,
      limits: { maxOutputEdge: 16_384, maxOutputPixels: 64_000_000 },
    });
    expect(prepared.frame.raster).toEqual({ w: 8, h: 10 });
    expect(prepared.frame.baseToRaster).toEqual([0, 1, -1, 0, 9, -2]);
    const pinned = await prepareReferenceArtifact(handle.path, {
      w: 8,
      h: 10,
      png: await sharp({
        create: { width: 8, height: 10, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
    });
    const border = await commitCanvasExpansion(handle, handle.path, {
      prepared,
      artifacts: [pinned.artifact, pinned.encodedArtifact],
      content: { localKey: pinned.node.localKey },
      nodes: [pinned.node],
    });
    if (!border.changed) throw new Error("The requested border must expand the canvas");
    const expanded = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    expect(expanded.preview_info.actual).toMatchObject({ w: 8, h: 10 });
    expect(expanded.preview_info.base_to_view).toEqual({ a: 0, b: 1, c: -1, d: 0, e: 9, f: -2 });
    const expandedPixels = await currentPixels();
    const generated = await readArtifactLinear(pinned.artifact.path, pinned.artifact.artifactHash);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 8; x++) {
        const offset = (y * 8 + x) * 3;
        const interior = x >= 2 && x < 6 && y >= 2 && y < 8;
        const expected = interior
          ? beforePixels.data.slice(((y - 2) * 4 + x - 2) * 3, ((y - 2) * 4 + x - 2) * 3 + 3)
          : generated.data.slice(offset, offset + 3);
        expect(expandedPixels.data.slice(offset, offset + 3), `pixel ${x},${y}`).toEqual(expected);
      }

    await command("layer", ["set", id, border.layerId, "--opacity", "0"]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 8, h: 10 });
    await command("layer", ["set", id, border.layerId, "--enabled", "false"]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 4, h: 6 });
    expect(
      (await handle.query<{ w: number; h: number }>("SELECT w, h FROM photos WHERE id=$1", [id]))
        .rows,
    ).toEqual([{ w: 16, h: 12 }]);
    await command("layer", ["set", id, border.layerId, "--enabled", "true", "--opacity", "1"]);
    const expandedRevision = (await loadActiveDocument(handle, id))!.revisionId;
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    const restrictedRevision = (await loadActiveDocument(handle, id))!.revisionId;
    expect(restrictedRevision).not.toBe(expandedRevision);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 4, h: 6 });
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    expect((await loadActiveDocument(handle, id))!.revisionId).toBe(restrictedRevision);
    await command("develop", [id, "--unset", "crop"]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 8, h: 10 });
    await command("develop", [id, "--set", "rotate=180"]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 10, h: 8 });
    await command("develop", [id, "--set", "rotate=90"]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 8, h: 10 });
    expect((await currentPixels()).data).toEqual(expandedPixels.data);
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    const secondPrepared = await prepareCanvasExpansion(handle, {
      photoId: id,
      padding: 1,
      limits: { maxOutputEdge: 16_384, maxOutputPixels: 64_000_000 },
    });
    const secondPixels = await prepareReferenceArtifact(handle.path, {
      w: 6,
      h: 8,
      png: await sharp({
        create: { width: 6, height: 8, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer(),
    });
    const second = await commitCanvasExpansion(handle, handle.path, {
      prepared: secondPrepared,
      artifacts: [secondPixels.artifact, secondPixels.encodedArtifact],
      content: { localKey: secondPixels.node.localKey },
      nodes: [secondPixels.node],
    });
    if (!second.changed) throw new Error("The second border must expand again");
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 6, h: 8 });
    const twice = await currentPixels();
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 4; x++) {
        expect(twice.data.slice(((y + 1) * 6 + x + 1) * 3, ((y + 1) * 6 + x + 1) * 3 + 3)).toEqual(
          beforePixels.data.slice((y * 4 + x) * 3, (y * 4 + x) * 3 + 3),
        );
      }
    const thirdPrepared = await prepareCanvasExpansion(handle, {
      photoId: id,
      padding: 1,
      limits: { maxOutputEdge: 16_384, maxOutputPixels: 64_000_000 },
    });
    const thirdPixels = await prepareReferenceArtifact(handle.path, {
      w: 8,
      h: 10,
      png: await sharp({
        create: { width: 8, height: 10, channels: 3, background: "green" },
      })
        .png()
        .toBuffer(),
    });
    const third = await commitCanvasExpansion(handle, handle.path, {
      prepared: thirdPrepared,
      artifacts: [thirdPixels.artifact, thirdPixels.encodedArtifact],
      content: { localKey: thirdPixels.node.localKey },
      nodes: [thirdPixels.node],
    });
    if (!third.changed) throw new Error("The third border must expand again");
    await command("show", [id, "--preview-size", "native"]);
    const thrice = await currentPixels();
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 6; x++) {
        expect(thrice.data.slice(((y + 1) * 8 + x + 1) * 3, ((y + 1) * 8 + x + 1) * 3 + 3)).toEqual(
          twice.data.slice((y * 6 + x) * 3, (y * 6 + x) * 3 + 3),
        );
      }
    await handle.query(
      "UPDATE image_artifacts SET artifact_available = false WHERE artifact_hash = $1",
      [secondPixels.artifact.artifactHash],
    );
    await rm(secondPixels.artifact.path);
    await command("layer", ["remove", id, second.layerId]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 8, h: 10 });
    const missingMiddle = await currentPixels();
    expect(missingMiddle.data.slice((1 * 8 + 1) * 3, (1 * 8 + 1) * 3 + 3)).toEqual(
      new Float32Array([0, 0, 0]),
    );
    await command("layer", ["remove", id, border.layerId]);
    await command("show", [id, "--preview-size", "native"]);
    expect((await currentPixels()).data).toEqual(missingMiddle.data);
    await command("layer", ["remove", id, third.layerId]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 4, h: 6 });
    expect((await currentPixels()).data).toEqual(beforePixels.data);
  } finally {
    await fixture.close();
  }
});

test("straightened borders preserve inherited exclusions and restore the current controls when disabled", async () => {
  const fixture = await createCanvasFixture(1000, 800);
  const { handle, id, command, currentPixels, author } = fixture;
  try {
    await command("develop", [
      id,
      "--set",
      'crop={"x":100,"y":200,"w":400,"h":200}',
      "--set",
      "rotate=90",
      "--set",
      "straighten_deg=10",
    ]);
    await command("show", [id, "--preview-size", "native"]);
    const cropped = await currentPixels();
    expect({ w: cropped.w, h: cropped.h }).toEqual({ w: 135, h: 382 });
    const a = await author(20, "red");
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 175, h: 422 });
    const authored = await currentPixels();
    for (let y = 0; y < cropped.h; y++) {
      expect(authored.data.slice(((y + 20) * 175 + 20) * 3, ((y + 20) * 175 + 155) * 3)).toEqual(
        cropped.data.slice(y * 135 * 3, (y + 1) * 135 * 3),
      );
    }
    await command("develop", [id, "--set", "straighten_deg=5"]);
    const tilted = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    expect(tilted.preview_info.actual.w).toBeLessThan(175);
    expect(tilted.preview_info.actual.h).toBeLessThan(422);
    await command("develop", [id, "--set", "straighten_deg=10"]);
    await command("show", [id, "--preview-size", "native"]);
    expect((await currentPixels()).data).toEqual(authored.data);
    await command("develop", [
      id,
      "--set",
      'crop={"x":180,"y":230,"w":200,"h":120}',
      "--set",
      "rotate=180",
      "--set",
      "straighten_deg=5",
    ]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 191, h: 103 });
    const b = await author(10, "blue");
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 211, h: 123 });
    const supported = await currentPixels();
    const at = (111 * 211 + 199) * 3;
    expect(supported.data[at]).toBeGreaterThan(0.5);
    await command("layer", ["set", id, a.layerId, "--enabled", "false"]);
    await command("show", [id, "--preview-size", "native"]);
    expect((await currentPixels()).data.slice(at, at + 3)).toEqual(new Float32Array([0, 0, 0]));
    await command("layer", ["set", id, b.layerId, "--enabled", "false"]);
    expect(
      showDataSchema.parse(await command("show", [id, "--preview-size", "native"])).preview_info
        .actual,
    ).toMatchObject({ w: 191, h: 103 });
    const fallback = await currentPixels();
    expect(
      fallback.data
        .slice((101 * 191 + 189) * 3, (101 * 191 + 189) * 3 + 3)
        .some((value) => value > 0),
    ).toBe(true);
    await command("layer", ["set", id, a.layerId, "--enabled", "true"]);
    await command("layer", ["set", id, b.layerId, "--enabled", "true"]);
    await command("show", [id, "--preview-size", "native"]);
    expect((await currentPixels()).data).toEqual(supported.data);
    expect((await handle.query("SELECT w, h FROM photos WHERE id = $1", [id])).rows).toEqual([
      { w: 1000, h: 800 },
    ]);
  } finally {
    await fixture.close();
  }
}, 30_000);

test("a post-border local layer retains extension pixels while a pre-border hidden layer stays excluded", async () => {
  const fixture = await createCanvasFixture();
  const { id, command, currentPixels, author } = fixture;
  try {
    await command("segment", [id, "--box", "3,4,1,1"]);
    await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}', "--set", "rotate=90"]);
    const a = await author(2, "red");
    const local = segmentDataSchema.parse(await command("segment", [id, "--box", "3,4,1,1"]));
    await author(1, "blue");
    await command("layer", ["remove", id, a.layerId]);
    await command("show", [id, "--preview-size", "native"]);
    const pixels = await currentPixels();
    // Original cell [3,4] maps to cell [5,2] after crop, quarter-turn and both integer borders.
    const offset = (2 * 10 + 5) * 3;
    expect(pixels.data[offset]).toBeGreaterThan(0.5);
    await command("layer", ["remove", id, local.layer_id]);
    await command("show", [id, "--preview-size", "native"]);
    expect((await currentPixels()).data.slice(offset, offset + 3)).toEqual(
      new Float32Array([0, 0, 0]),
    );
  } finally {
    await fixture.close();
  }
});
