import { initializeLibrary } from "@photoctl/library";
import { GatewayClient, GatewayImageModelAdapter } from "@photoctl/providers";
import type {
  ReimagineData,
  RelightData,
  GraphAttemptsData,
  GraphAttemptData,
  ExportResult,
} from "@photoctl/protocol";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import {
  artifactPath,
  loadActiveDocument,
  readArtifactLinear,
  readArtifactImage,
  loadLogicalFrame,
  transformPoint,
} from "@photoctl/render";
import { image16Png } from "../../render/src/fill/external-pixels.js";
import { mkdtemp, rm, mkdir, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

async function fixture(flat = false) {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-full-frame-"));
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  const source = join(parent, "source.png");
  const data = Buffer.alloc(40 * 30 * 3);
  for (let y = 0; y < 30; y++)
    for (let x = 0; x < 40; x++) {
      data[(y * 40 + x) * 3] = 20 + x * 5;
      data[(y * 40 + x) * 3 + 1] = 15 + y * 7;
      data[(y * 40 + x) * 3 + 2] = (x + y) % 3 ? 40 : 180;
    }
  await sharp(data, { raw: { width: 40, height: 30, channels: 3 } })
    .png()
    .toFile(source);
  if (flat)
    await sharp({
      create: { width: 40, height: 30, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .png()
      .toFile(source);
  const server = await startGatewayFixture(0, { imageMode: "checkerboard" });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing gateway");
  const gateway = new GatewayClient({
    apiKey: "fixture",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  });
  const sent: Buffer[] = [];
  const hooks: { afterResponse?: () => Promise<void> } = {};
  const fill = {
    model: "fixture/native-image-v1",
    adapter: new GatewayImageModelAdapter({
      model: "fixture/native-image-v1",
      mask: "native",
      maskPolarity: "transparent-edits",
    }),
    gateway: {
      imageEdits: async (body: FormData) => {
        const image = body.get("image");
        if (!(image instanceof Blob)) throw new Error("Missing input image");
        sent.push(Buffer.from(await image.arrayBuffer()));
        const result = await gateway.imageEdits(body);
        await hooks.afterResponse?.();
        return result;
      },
    },
    upscaleSettings: { generation: { upscale: "off" as const } },
  };
  const response = async (verb: string, args: string[]) =>
    await dispatch(
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
      { version: "test", library: handle, fill },
    );
  const command = async <T = Record<string, unknown>>(verb: string, args: string[]): Promise<T> => {
    const result = await response(verb, args);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(JSON.stringify(result));
    return ("data" in result ? result.data : result) as T;
  };
  const id = (await command<{ ids: string[] }>("import", [source, "--link"])).ids[0]!;
  const pixels = async () => {
    await command("show", [id, "--preview-size", "native"]);
    const document = (await loadActiveDocument(handle, id))!;
    const row = (
      await handle.query<{ output_artifact_hash: string; render_frame: unknown }>(
        "SELECT output_artifact_hash, render_frame FROM node_executions WHERE photo_id=$1 AND node_id=$2 ORDER BY created_at DESC LIMIT 1",
        [id, document.roots.output],
      )
    ).rows[0]!;
    const path = artifactPath(handle.path, row.output_artifact_hash, "tif");
    return {
      path,
      image: await readArtifactLinear(path, row.output_artifact_hash),
      frame: row.render_frame,
      png: await image16Png(await readArtifactImage(path, row.output_artifact_hash)),
    };
  };
  return {
    parent,
    handle,
    id,
    command,
    response,
    pixels,
    sent,
    hooks,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await handle.close();
      await rm(parent, { recursive: true });
    },
  };
}

test("retouch accepts a generated corner only while its photographic layer supplies coverage", async () => {
  const f = await fixture();
  try {
    await f.command("develop", [f.id, "--set", 'crop={"x":4,"y":3,"w":6,"h":4}']);
    const border = await f.command<{ graph: { layer: string } }>("fill", [
      f.id,
      "--outpaint",
      "--px",
      "2",
      "--prompt",
      "continue the scene",
    ]);
    await f.command("layer", [
      "transform",
      f.id,
      border.graph.layer,
      "--rotate",
      "30",
      "--anchor",
      "0,0",
    ]);
    const empty = await f.pixels();
    expect(empty.image.data.slice(0, 3)).toEqual(new Float32Array([0, 0, 0]));
    const document = (await loadActiveDocument(f.handle, f.id))!;
    const frame = await loadLogicalFrame(f.handle, f.id, document.roots.output);
    const corner = transformPoint(frame.rasterToBase, { x: 0.5, y: 0.5 });
    const args = [f.id, "--at", `${corner.x},${corner.y}`, "--radius", "0.1"];
    const rejected = async () => {
      const before = (await loadActiveDocument(f.handle, f.id))!.revisionId;
      expect(await f.response("retouch", args)).toMatchObject({ ok: false, code: "usage" });
      expect((await loadActiveDocument(f.handle, f.id))!.revisionId).toBe(before);
    };
    await rejected();
    const generated = await f.command<ReimagineData>("reimagine", [
      f.id,
      "--prompt",
      "painted",
      "--strength",
      "1",
    ]);
    expect((await f.pixels()).image.data.slice(0, 3)).not.toEqual(new Float32Array([0, 0, 0]));
    await f.command("layer", ["set", f.id, generated.layer_id, "--opacity", "0"]);
    await rejected();
    await f.command("layer", ["set", f.id, generated.layer_id, "--opacity", "1"]);
    const beforeHeal = await f.pixels();
    await f.command("retouch", args);
    const healed = await f.pixels();
    expect(healed.frame).toEqual(beforeHeal.frame);
    expect(healed.image.data.slice(3)).toEqual(beforeHeal.image.data.slice(3));
    await f.command("undo", [f.id]);
    expect(await f.pixels()).toEqual(beforeHeal);
    await f.command("layer", ["remove", f.id, generated.layer_id]);
    await rejected();
    expect(f.sent).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test("preview metadata follows the reused deterministic execution's source tier", async () => {
  const f = await fixture(true);
  try {
    const libraryId = (await f.command<{ library_id: string }>("doctor", [])).library_id;
    const pinned = join(f.parent, "cache", libraryId, "emb");
    await mkdir(pinned, { recursive: true });
    await sharp(join(f.parent, "source.png"))
      .jpeg()
      .toFile(join(pinned, `${f.id}.jpg`));
    await rename(join(f.parent, "source.png"), join(f.parent, "source.offline"));
    await f.command("develop", [f.id, "--set", "exposure=0.5"]);
    const before = await f.command<{ preview_info: { source_tier: string } }>("show", [
      f.id,
      "--preview-size",
      "native",
    ]);
    expect(before.preview_info.source_tier).toBe("pinned-preview");
    await rename(join(f.parent, "source.offline"), join(f.parent, "source.png"));
    await rm(join(f.parent, "cache"), { recursive: true, force: true });
    const after = await f.command<{ preview_info: { source_tier: string } }>("show", [
      f.id,
      "--preview-size",
      "native",
    ]);
    expect(after.preview_info.source_tier).toBe(before.preview_info.source_tier);
  } finally {
    await f.close();
  }
});

test("non-power reduced retained input can refresh inside its captured fractional viewport", async () => {
  const f = await fixture();
  try {
    const libraryId = (await f.command<{ library_id: string }>("doctor", [])).library_id;
    const pinned = join(f.parent, "cache", libraryId, "emb");
    await mkdir(pinned, { recursive: true });
    await sharp(join(f.parent, "source.png"))
      .resize(17, 13, { fit: "fill" })
      .jpeg()
      .toFile(join(pinned, `${f.id}.jpg`));
    await rm(join(f.parent, "source.png"));
    await f.command("develop", [
      f.id,
      "--set",
      'crop={"x":5,"y":7,"w":20,"h":12}',
      "straighten_deg=7.25",
    ]);
    const edit = await f.command<ReimagineData>("reimagine", [
      f.id,
      "--prompt",
      "fractional sampling",
      "--strength",
      "0.5",
    ]);
    await rm(join(pinned, `${f.id}.jpg`));
    const authored = (
      await f.command<{ parameters: { request: { full_frame: { authored_frame: unknown } } } }>(
        "graph",
        ["node", f.id, edit.generation.node],
      )
    ).parameters.request.full_frame.authored_frame;
    const refresh = await f.command<{ generation: { node: string } }>("layer", [
      "refresh",
      f.id,
      edit.layer_id,
    ]);
    expect(
      (
        await f.command<{ parameters: { request: { full_frame: { authored_frame: unknown } } } }>(
          "graph",
          ["node", f.id, refresh.generation.node],
        )
      ).parameters.request.full_frame.authored_frame,
    ).toEqual(authored);
    expect(f.sent).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test("reconstructed reduced input cannot outrank a better available pinned source", async () => {
  const f = await fixture();
  try {
    const libraryId = (await f.command<{ library_id: string }>("doctor", [])).library_id;
    const directory = join(f.parent, "cache", libraryId, "emb");
    const pinned = join(directory, `${f.id}.jpg`);
    const original = join(f.parent, "source.png");
    await mkdir(directory, { recursive: true });
    await sharp(original).resize(10, 8, { fit: "fill" }).jpeg().toFile(pinned);
    await rename(original, join(f.parent, "source.offline"));
    await f.pixels();
    await sharp(join(f.parent, "source.offline")).resize(20, 15).jpeg().toFile(pinned);
    await f.command("develop", [f.id, "--set", "exposure=0.5"]);
    const edit = await f.command<ReimagineData>("reimagine", [
      f.id,
      "--prompt",
      "better pinned input",
    ]);
    expect(edit.source_context).toMatchObject({ tier: "pinned-preview", pixel_scale: 0.5 });
    expect(await sharp(f.sent[0]!).metadata()).toMatchObject({ width: 20, height: 15 });
  } finally {
    await f.close();
  }
});

test("a retained native photographic input outranks a smaller pinned fallback", async () => {
  const f = await fixture();
  try {
    const input = await f.pixels();
    const libraryId = (await f.command<{ library_id: string }>("doctor", [])).library_id;
    const pinned = join(f.parent, "cache", libraryId, "emb");
    await mkdir(pinned, { recursive: true });
    await sharp(join(f.parent, "source.png"))
      .resize(20, 15)
      .jpeg()
      .toFile(join(pinned, `${f.id}.jpg`));
    await rm(join(f.parent, "source.png"));
    await f.command("reimagine", [f.id, "--prompt", "best retained input"]);
    expect(f.sent).toEqual([input.png]);
  } finally {
    await f.close();
  }
});

test.each(["show", "export"])(
  "retained-only %s after full-frame refresh works with both original and pinned source absent",
  async (first) => {
    const f = await fixture();
    try {
      await f.command("develop", [
        f.id,
        "--set",
        'crop={"x":5,"y":7,"w":20,"h":12}',
        "straighten_deg=7.25",
      ]);
      await f.command("reimagine", [
        f.id,
        "--prompt",
        "captured predecessor",
        "--strength",
        "0.35",
      ]);
      const input = await f.pixels();
      await rename(join(f.parent, "source.png"), join(f.parent, "source.offline"));
      await rm(join(f.parent, "cache"), { recursive: true, force: true });
      const edit = await f.command<ReimagineData>("reimagine", [
        f.id,
        "--prompt",
        "Retained photographic input",
        "--strength",
        "0.5",
      ]);
      expect(f.sent.slice(1)).toEqual([input.png]);
      await f.command("layer", ["refresh", f.id, edit.layer_id]);
      expect(f.sent.slice(1)).toEqual([input.png, input.png]);
      const exportRetained = () =>
        f.response("export", [
          f.id,
          "--to",
          join(f.parent, "retained-delivery"),
          "--format",
          "png",
        ]);
      if (first === "export") expect(await exportRetained()).toMatchObject({ ok: true });
      const shown = await f.pixels();
      const exported = await exportRetained();
      expect(exported).toMatchObject({ ok: true, summary: { ok: 1, failed: 0 } });
      await f.command("layer", ["remove", f.id, edit.layer_id]);
      expect((await f.pixels()).image.data).toEqual(input.image.data);
      await f.command("undo", [f.id]);
      expect((await f.pixels()).image.data).toEqual(shown.image.data);
      await rename(join(f.parent, "source.offline"), join(f.parent, "source.png"));
      await rm(join(f.parent, "cache"), { recursive: true, force: true });
      expect((await f.pixels()).image.data).toEqual(shown.image.data);
      expect(f.sent).toHaveLength(3);
    } finally {
      await f.close();
    }
  },
);

test.each(["missing", "corrupt"])(
  "retained-only display never replays a %s paid artifact",
  async (mode) => {
    const f = await fixture();
    try {
      const edit = await f.command<ReimagineData>("reimagine", [f.id, "--prompt", "do not replay"]);
      const row = (
        await f.handle.query<{ output_artifact_hash: string }>(
          "SELECT output_artifact_hash FROM node_executions WHERE photo_id=$1 AND node_id=$2",
          [f.id, edit.generation.node],
        )
      ).rows[0]!;
      const path = artifactPath(f.handle.path, row.output_artifact_hash, "tif");
      if (mode === "missing") await rm(path);
      else await writeFile(path, "corrupt paid pixels");
      await rm(join(f.parent, "source.png"));
      await rm(join(f.parent, "cache"), { recursive: true, force: true });
      expect(await f.response("show", [f.id, "--preview-size", "native"])).toMatchObject({
        ok: false,
        code: "file_offline",
        data: { reason: "retained_artifact_unavailable" },
      });
      expect(
        await f.response("export", [f.id, "--to", join(f.parent, "missing-paid")]),
      ).toMatchObject({
        ok: false,
        results: [{ code: "file_offline", reason: "retained_artifact_unavailable" }],
      });
      expect(f.sent).toHaveLength(1);
    } finally {
      await f.close();
    }
  },
);

test.each(["missing", "corrupt"])(
  "unusable %s retained full-frame input never purchases replacement pixels",
  async (mode) => {
    const f = await fixture();
    try {
      await f.command("develop", [f.id, "--set", 'crop={"x":5,"y":7,"w":20,"h":12}']);
      const input = await f.pixels();
      await rm(join(f.parent, "source.png"));
      await rm(join(f.parent, "cache"), { recursive: true, force: true });
      const sources = (
        await f.handle.query<{ output_artifact_hash: string }>(
          "SELECT DISTINCT output_artifact_hash FROM node_executions e JOIN image_nodes n ON n.photo_id=e.photo_id AND n.id=e.node_id WHERE e.photo_id=$1 AND n.kind='source'",
          [f.id],
        )
      ).rows;
      await Promise.all(
        sources.map(({ output_artifact_hash }) =>
          rm(artifactPath(f.handle.path, output_artifact_hash, "tif")),
        ),
      );
      if (mode === "missing") await rm(input.path);
      else await writeFile(input.path, "corrupt retained input");
      const before = await loadActiveDocument(f.handle, f.id);
      expect(await f.response("reimagine", [f.id, "--prompt", "must not purchase"])).toMatchObject({
        ok: false,
        code: "file_offline",
      });
      expect(f.sent).toHaveLength(0);
      expect((await loadActiveDocument(f.handle, f.id))!.revisionId).toBe(before!.revisionId);
    } finally {
      await f.close();
    }
  },
);

test("a lost full-frame refresh response leaves the active branch intact and is not replayed by show", async () => {
  const f = await fixture();
  try {
    const edit = await f.command<ReimagineData>("reimagine", [
      f.id,
      "--prompt",
      "retained purchase",
    ]);
    const before = await f.pixels();
    const document = await loadActiveDocument(f.handle, f.id);
    f.hooks.afterResponse = async () => {
      throw new Error("fixture lost response");
    };
    expect(await f.response("layer", ["refresh", f.id, edit.layer_id])).toMatchObject({
      ok: false,
    });
    expect((await loadActiveDocument(f.handle, f.id))!.revisionId).toBe(document!.revisionId);
    expect((await f.pixels()).image.data).toEqual(before.image.data);
    expect(f.sent).toHaveLength(2);
    const attempts = await f.command<GraphAttemptsData>("graph", ["attempts"]);
    expect(attempts.attempts).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test("full-frame refresh keeps its authored viewport while applying current photometric develop", async () => {
  const f = await fixture();
  try {
    await f.command("develop", [
      f.id,
      "--set",
      'crop={"x":5,"y":7,"w":20,"h":12}',
      "rotate=90",
      "exposure=0.5",
    ]);
    const expected = await f.pixels();
    await f.command("develop", [f.id, "--set", "exposure=0"]);
    const edit = await f.command<ReimagineData>("reimagine", [
      f.id,
      "--prompt",
      "fixed viewport",
      "--strength",
      "0.35",
    ]);
    await f.command("develop", [
      f.id,
      "--set",
      'crop={"x":0,"y":0,"w":40,"h":30}',
      "rotate=0",
      "exposure=0.5",
    ]);
    await f.command("layer", ["refresh", f.id, edit.layer_id]);
    expect(f.sent[1]).toEqual(expected.png);
    const refreshed = await f.pixels();
    expect(refreshed.image).toMatchObject({ w: 40, h: 30 });
    await f.command("layer", ["remove", f.id, edit.layer_id]);
    const removed = await f.pixels();
    for (let y = 0; y < 30; y++)
      for (let x = 0; x < 40; x++) {
        if (x >= 5 && x < 25 && y >= 7 && y < 19) continue;
        const offset = (y * 40 + x) * 3;
        expect(refreshed.image.data.slice(offset, offset + 3)).toEqual(
          removed.image.data.slice(offset, offset + 3),
        );
      }
  } finally {
    await f.close();
  }
});

test("refresh honors captured predecessor enablement and removal rather than today's stack", async () => {
  const f = await fixture();
  try {
    const original = await f.pixels();
    const predecessor = await f.command<ReimagineData>("reimagine", [
      f.id,
      "--prompt",
      "predecessor",
      "--strength",
      "0.35",
    ]);
    const expected = await f.pixels();
    const selected = await f.command<ReimagineData>("reimagine", [f.id, "--prompt", "selected"]);
    await f.command("reimagine", [f.id, "--prompt", "later"]);
    await f.command("layer", ["reorder", f.id, predecessor.layer_id, "--front"]);
    const reordered = (await loadActiveDocument(f.handle, f.id))!.layers.map((layer) => layer.id);
    await f.command("layer", ["refresh", f.id, selected.layer_id]);
    expect(f.sent[3]).toEqual(expected.png);
    expect((await loadActiveDocument(f.handle, f.id))!.layers.map((layer) => layer.id)).toEqual(
      reordered,
    );
    await f.command("layer", ["set", f.id, predecessor.layer_id, "--enabled", "false"]);
    await f.command("layer", ["refresh", f.id, selected.layer_id]);
    expect(f.sent[4]).toEqual(original.png);
    await f.command("layer", ["remove", f.id, predecessor.layer_id]);
    await f.command("layer", ["refresh", f.id, selected.layer_id]);
    expect(f.sent[5]).toEqual(original.png);
  } finally {
    await f.close();
  }
});

test("unchanged deterministic full-frame response preserves intermediate-strength pixels on refresh", async () => {
  const f = await fixture();
  try {
    await f.command("develop", [f.id, "--set", 'crop={"x":5,"y":7,"w":20,"h":12}', "rotate=90"]);
    const edit = await f.command<ReimagineData>("reimagine", [
      f.id,
      "--prompt",
      "same response",
      "--strength",
      "0.35",
    ]);
    const before = await f.pixels();
    await f.command("layer", ["refresh", f.id, edit.layer_id]);
    expect(f.sent[1]).toEqual(f.sent[0]);
    expect((await f.pixels()).image.data).toEqual(before.image.data);
  } finally {
    await f.close();
  }
});

test.each([0, 0.35, 1])(
  "generated detail at strength %s cannot certify a reduced original as native",
  async (strength) => {
    const f = await fixture();
    try {
      const libraryId = (await f.command<{ library_id: string }>("doctor", [])).library_id;
      const pinned = join(f.parent, "cache", libraryId, "emb");
      await mkdir(pinned, { recursive: true });
      await sharp(join(f.parent, "source.png"))
        .resize(20, 15)
        .jpeg()
        .toFile(join(pinned, `${f.id}.jpg`));
      await rm(join(f.parent, "source.png"));
      await f.command("reimagine", [
        f.id,
        "--prompt",
        "fine generated detail",
        "--strength",
        String(strength),
      ]);
      const shown = await f.command<{
        preview_info: { source_tier: string; resolution_limited: boolean };
      }>("show", [f.id, "--preview-size", "native"]);
      expect(shown.preview_info).toMatchObject({
        source_tier: "pinned-preview",
        resolution_limited: true,
      });
      expect(f.sent).toHaveLength(1);
    } finally {
      await f.close();
    }
  },
);

test("transforming a cropped retouch preserves its authored mask placement", async () => {
  const f = await fixture();
  try {
    await f.command("develop", [f.id, "--set", 'crop={"x":5,"y":7,"w":20,"h":12}', "rotate=90"]);
    const before = await f.pixels();
    const edit = await f.command<{ layer_id: string }>("retouch", [
      f.id,
      "--at",
      "13,12",
      "--radius",
      "2",
    ]);
    const healed = await f.pixels();
    expect(healed.image.data).not.toEqual(before.image.data);
    await f.command("layer", ["transform", f.id, edit.layer_id, "--dx", "0"]);
    const unchanged = await f.pixels();
    expect(unchanged.frame).toEqual(healed.frame);
    expect(unchanged.image.data).toEqual(healed.image.data);
    await f.command("layer", ["transform", f.id, edit.layer_id, "--dx", "2", "--dy", "1"]);
    expect((await f.pixels()).image.data).not.toEqual(healed.image.data);
    await f.command("layer", [
      "transform",
      f.id,
      edit.layer_id,
      "--dx",
      "-2",
      "--dy",
      "-1",
      "--relative",
    ]);
    expect((await f.pixels()).image.data).toEqual(healed.image.data);
  } finally {
    await f.close();
  }
});

test("full-frame edits retain cropped coordinates through show, toggle, later crop, remove and undo", async () => {
  const f = await fixture();
  try {
    await f.command("develop", [f.id, "--set", 'crop={"x":5,"y":7,"w":20,"h":12}', "rotate=90"]);
    const before = await f.pixels();
    const edit = await f.command<ReimagineData>("reimagine", [
      f.id,
      "--prompt",
      "painted",
      "--strength",
      "1",
    ]);
    const generated = await f.pixels();
    expect(generated.image).toMatchObject({ w: before.image.w, h: before.image.h });
    expect(generated.frame).toEqual(before.frame);
    expect(generated.image.data).not.toEqual(before.image.data);
    await f.command("layer", ["transform", f.id, edit.layer_id, "--dx", "0"]);
    expect((await f.pixels()).image.data).toEqual(generated.image.data);
    const exported = await f.command<{ results: ExportResult[] }>("export", [
      f.id,
      "--to",
      join(f.parent, "delivery"),
      "--format",
      "png",
    ]);
    const delivery = exported.results[0]!;
    expect(await sharp(delivery.file).removeAlpha().raw().toBuffer()).toEqual(
      await sharp(generated.png).removeAlpha().raw().toBuffer(),
    );
    await f.command("layer", ["set", f.id, edit.layer_id, "--enabled", "false"]);
    expect(await f.pixels()).toEqual(before);
    await f.command("layer", ["set", f.id, edit.layer_id, "--enabled", "true"]);
    expect(await f.pixels()).toEqual(generated);
    await f.command("develop", [f.id, "--set", 'crop={"x":0,"y":0,"w":40,"h":30}', "rotate=0"]);
    const expanded = await f.pixels();
    await f.command("layer", ["set", f.id, edit.layer_id, "--enabled", "false"]);
    const original = await f.pixels();
    let changed = 0;
    for (let y = 0; y < 30; y++)
      for (let x = 0; x < 40; x++) {
        const offset = (y * 40 + x) * 3;
        const actual = expanded.image.data.slice(offset, offset + 3);
        const source = original.image.data.slice(offset, offset + 3);
        if (x < 5 || x >= 25 || y < 7 || y >= 19) expect(actual).toEqual(source);
        else {
          const authoredOffset = ((x - 5) * 12 + 11 - (y - 7)) * 3;
          expect(actual).toEqual(generated.image.data.slice(authoredOffset, authoredOffset + 3));
          if (actual.some((value, channel) => value !== source[channel])) changed++;
        }
      }
    expect(changed).toBe(20 * 12);
    await f.command("layer", ["set", f.id, edit.layer_id, "--enabled", "true"]);
    await f.command("layer", ["remove", f.id, edit.layer_id]);
    const restored = await f.pixels();
    expect(restored).toEqual(original);
    await f.command("undo", [f.id]);
    expect(await f.pixels()).toEqual(expanded);
    expect(f.sent).toHaveLength(1);
    const destination = process.env.PHOTOCTL_FULL_FRAME_CAPTURE_DIR;
    if (destination) {
      await mkdir(destination, { recursive: true });
      await Promise.all(
        Object.entries({ before, generated, expanded, restored }).map(
          async ([name, pixels]) => await writeFile(join(destination, `${name}.png`), pixels.png),
        ),
      );
    }
  } finally {
    await f.close();
  }
});

test("full-frame publication failure leaves the active photo intact and retains purchased bytes", async () => {
  const f = await fixture();
  try {
    const before = await f.pixels();
    const document = await loadActiveDocument(f.handle, f.id);
    await f.handle.query(
      "CREATE FUNCTION reject_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced revision failure'; END $$",
    );
    await f.handle.query(
      "CREATE TRIGGER reject_revision BEFORE INSERT ON document_revisions FOR EACH ROW EXECUTE FUNCTION reject_revision()",
    );
    expect(await f.response("reimagine", [f.id, "--prompt", "painted"])).toMatchObject({
      ok: false,
    });
    expect(await loadActiveDocument(f.handle, f.id)).toEqual(document);
    expect(await f.pixels()).toEqual(before);
    const attempts = await f.command<GraphAttemptsData>("graph", ["attempts"]);
    expect(attempts.attempts).toMatchObject([
      { state: "failed", original: { recorded_available: true } },
    ]);
    const attempt = await f.command<GraphAttemptData>("graph", [
      "attempt",
      attempts.attempts[0]!.id,
    ]);
    expect(await sharp(attempt.original!.path).metadata()).toMatchObject({ width: 40, height: 30 });
    expect(f.sent).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("relight transmits the photographic predecessors while leaving visible markup editable", async () => {
  const f = await fixture();
  try {
    const original = await f.pixels();
    const predecessor = await f.command<ReimagineData>("reimagine", [
      f.id,
      "--prompt",
      "painted",
      "--strength",
      "1",
    ]);
    const photographic = await f.pixels();
    await f.command("markup", [
      "add",
      f.id,
      "--json",
      JSON.stringify({
        type: "rect",
        bbox: [3, 2, 12, 10],
        width: 1,
        color: "#ff0000",
        fill: "#ff0000",
      }),
    ]);
    const marked = await f.pixels();
    expect(marked.png).not.toEqual(photographic.png);
    expect(photographic.png).not.toEqual(original.png);
    const edit = await f.command<RelightData>("relight", [
      f.id,
      "--azimuth",
      "90",
      "--elevation",
      "45",
      "--intensity",
      "0.5",
    ]);
    expect(f.sent[1]).toEqual(photographic.png);
    const intent = (
      await f.handle.query<{
        request: { full_frame: { predecessor_layer_ids: string[]; input_policy: string } };
      }>("SELECT parameters->'request' AS request FROM image_nodes WHERE photo_id=$1 AND id=$2", [
        f.id,
        edit.generation.node,
      ])
    ).rows[0]!.request.full_frame;
    expect(intent).toMatchObject({
      input_policy: "photographic-composite",
      predecessor_layer_ids: [predecessor.layer_id],
    });
    await f.command("layer", ["remove", f.id, edit.layer_id]);
    expect(await f.pixels()).toEqual(marked);
    expect(f.sent).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test.each([0, 0.35, 1])(
  "straightened full-frame generation applies strength %s exactly once",
  async (strength) => {
    const f = await fixture();
    try {
      await f.command("develop", [
        f.id,
        "--set",
        'crop={"x":4,"y":6,"w":24,"h":16}',
        "straighten_deg=7.25",
      ]);
      const before = await f.pixels();
      const edit = await f.command<ReimagineData>("reimagine", [
        f.id,
        "--prompt",
        "painted",
        "--strength",
        String(strength),
      ]);
      const actual = await f.pixels();
      const row = (
        await f.handle.query<{ output_artifact_hash: string }>(
          "SELECT output_artifact_hash FROM node_executions WHERE photo_id=$1 AND node_id=$2",
          [f.id, edit.generation.node],
        )
      ).rows[0]!;
      const purchased = await readArtifactLinear(
        artifactPath(f.handle.path, row.output_artifact_hash, "tif"),
        row.output_artifact_hash,
      );
      expect(actual.frame).toEqual(before.frame);
      expect(f.sent[0]).toEqual(before.png);
      let maxError = 0;
      for (let i = 0; i < actual.image.data.length; i++) {
        const expected = before.image.data[i]! * (1 - strength) + purchased.data[i]! * strength;
        maxError = Math.max(maxError, Math.abs(actual.image.data[i]! - expected));
      }
      expect(maxError).toBeLessThan(1e-6);
    } finally {
      await f.close();
    }
  },
);

test("same-size shifted viewports never move a full-frame purchase with the crop", async () => {
  const f = await fixture();
  try {
    await f.command("develop", [f.id, "--set", 'crop={"x":5,"y":7,"w":20,"h":12}']);
    const edit = await f.command<ReimagineData>("reimagine", [
      f.id,
      "--prompt",
      "painted",
      "--strength",
      "1",
    ]);
    const authored = await f.pixels();
    await f.command("develop", [f.id, "--set", 'crop={"x":15,"y":7,"w":20,"h":12}']);
    const shifted = await f.pixels();
    await f.command("layer", ["set", f.id, edit.layer_id, "--enabled", "false"]);
    const base = await f.pixels();
    expect(shifted.image).toMatchObject({ w: authored.image.w, h: authored.image.h });
    expect(shifted.frame).not.toEqual(authored.frame);
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 20; x++) {
        const offset = (y * 20 + x) * 3;
        const expected =
          x < 10
            ? authored.image.data.slice(offset + 30, offset + 33)
            : base.image.data.slice(offset, offset + 3);
        expect(shifted.image.data.slice(offset, offset + 3)).toEqual(expected);
      }
    expect(f.sent).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("a concurrent revision wins without losing the rejected full-frame purchase", async () => {
  const f = await fixture();
  try {
    await f.pixels();
    let concurrent: Awaited<ReturnType<typeof loadActiveDocument>>;
    f.hooks.afterResponse = async () => {
      await f.command("develop", [f.id, "--set", "exposure=0.5"]);
      concurrent = await loadActiveDocument(f.handle, f.id);
    };
    expect(await f.response("reimagine", [f.id, "--prompt", "painted"])).toMatchObject({
      ok: false,
      code: "library_locked",
      data: { reason: "revision_conflict" },
    });
    expect(await loadActiveDocument(f.handle, f.id)).toEqual(concurrent!);
    const attempts = await f.command<GraphAttemptsData>("graph", ["attempts"]);
    expect(attempts.attempts).toMatchObject([
      { state: "failed", original: { recorded_available: true } },
    ]);
    expect(f.sent).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("explicit full-frame refresh purchases its captured predecessors without consuming itself or successors", async () => {
  const f = await fixture();
  try {
    await f.command("develop", [f.id, "--set", 'crop={"x":5,"y":7,"w":20,"h":12}']);
    const input = await f.pixels();
    const selected = await f.command<ReimagineData>("reimagine", [
      f.id,
      "--prompt",
      "painted",
      "--strength",
      "0.35",
    ]);
    await f.command("reimagine", [f.id, "--prompt", "successor", "--strength", "1"]);
    const refreshed = await f.command("layer", ["refresh", f.id, selected.layer_id]);
    expect(refreshed).toMatchObject({
      refreshed: { kind: "generate" },
      executions: [{ kind: "generate", reused: false }],
    });
    expect(f.sent[2]).toEqual(input.png);
    expect(f.sent).toHaveLength(3);
  } finally {
    await f.close();
  }
});
