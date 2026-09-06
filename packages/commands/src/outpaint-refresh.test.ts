import {
  exportResultSchema,
  fillStrictDataSchema,
  layerRefreshDataSchema,
  showDataSchema,
} from "@photoctl/protocol";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyFile } from "node:fs/promises";
import { loadActiveDocument } from "@photoctl/render";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";
import { fillUpscaleFixture, success } from "./fill-upscale-fixture.js";

test("camera JPEG refresh retains its cropped provider frame and updates photographic input", async () => {
  const fixture = await refreshFixture();
  const { command, captured } = fixture;
  try {
    const camera = join(fixture.parent, "DSC08819.JPG");
    await copyFile(
      fileURLToPath(new URL("../../../fixtures/camera/DSC08819.JPG", import.meta.url)),
      camera,
    );
    const imported = success(await command("import", [camera, "--link"])) as { ids: string[] };
    const id = imported.ids[0]!;
    expect(
      await command("develop", [
        id,
        "--set",
        'crop={"x":1800,"y":1000,"w":160,"h":120}',
        "--set",
        "rotate=90",
      ]),
    ).toMatchObject({ ok: true });
    const authored = fillStrictDataSchema.parse(
      success(
        await command("fill", [
          id,
          "--outpaint",
          "--px",
          "8",
          "--prompt",
          "continue the scene",
          "--no-upscale",
        ]),
      ),
    );
    const before = captured[0]!;
    expect(before).toMatchObject({ w: 136, h: 176 });
    expect(await command("develop", [id, "--set", "exposure=-1"])).toMatchObject({ ok: true });
    expect(await command("layer", ["refresh", id, authored.graph.layer])).toMatchObject({
      ok: true,
    });
    expect(captured).toHaveLength(2);
    expect(captured[1]).toMatchObject({ w: 136, h: 176, mask: before.mask });
    const average = (rgb: Buffer) => {
      let sum = 0;
      for (let y = 8; y < 168; y++)
        for (let x = 8; x < 128; x++)
          for (let c = 0; c < 3; c++) sum += rgb[(y * 136 + x) * 3 + c]!;
      return sum / (160 * 120 * 3);
    };
    expect(average(captured[1]!.rgb)).toBeLessThan(average(before.rgb) - 10);
    expect([...captured[1]!.rgb.subarray(0, 3)]).toEqual([0, 0, 0]);
    expect(
      showDataSchema.parse(success(await command("show", [id]))).preview_info.actual,
    ).toMatchObject({ w: 136, h: 176 });
    expect(captured).toHaveLength(2);
  } finally {
    await fixture.close();
  }
}, 60_000);

async function refreshFixture(options: Parameters<typeof fillUpscaleFixture>[0] = {}) {
  const fixture = await fillUpscaleFixture(options);
  const captured: Array<{ w: number; h: number; rgb: Buffer; mask: Buffer }> = [];
  let beforeGeneration: (() => Promise<void>) | undefined;
  const fill = {
    ...fixture.fill,
    source: undefined,
    sourceContext: undefined,
    gateway: {
      imageEdits: async (body: FormData) => {
        await beforeGeneration?.();
        const decoded = await sharp(Buffer.from(await (body.get("image") as Blob).arrayBuffer()))
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        captured.push({
          w: decoded.info.width,
          h: decoded.info.height,
          rgb: decoded.data,
          mask:
            body.get("mask") instanceof Blob
              ? Buffer.from(await (body.get("mask") as Blob).arrayBuffer())
              : Buffer.alloc(0),
        });
        return await fixture.fill.gateway.imageEdits(body);
      },
    },
  };
  const command = async (verb: string, args: string[]) =>
    await dispatch(
      { verb, args, cwd: fixture.parent, env: fixture.env },
      {
        version: "test",
        library: fixture.handle,
        fill: { ...fill, upscaleRegistry: fixture.fill.upscaleRegistry },
      },
    );
  return {
    ...fixture,
    command,
    captured,
    onGeneration: (callback: () => Promise<void>) => {
      beforeGeneration = callback;
    },
  };
}

test("outpaint retry reuses pinned generation after current edits and retries only failed density", async () => {
  const fixture = await refreshFixture({
    generationMode: "smallerdims",
    upscaleMode: "transport-failure",
  });
  const { command, id, captured, handle } = fixture;
  try {
    const authored = fillStrictDataSchema.parse(
      success(
        await command("fill", [id, "--outpaint", "--px", "2", "--prompt", "continue the scene"]),
      ),
    );
    expect(authored.upscale.node).toBeNull();
    expect(authored.upscale.density_satisfied).toBe(false);
    expect(await command("develop", [id, "--set", "exposure=1"])).toMatchObject({ ok: true });
    expect(
      await command("layer", [
        "transform",
        id,
        authored.graph.layer,
        "--dx",
        "4",
        "--anchor",
        "0,0",
      ]),
    ).toMatchObject({ ok: true });
    const before = await loadActiveDocument(handle, id);
    fixture.replaceUpscaleMode("normal");
    const retry = fillStrictDataSchema.parse(
      success(
        await command("fill", [
          id,
          "--layer",
          authored.graph.layer,
          "--prompt",
          "continue the scene",
        ]),
      ),
    );
    expect(retry.generation.node).toBe(authored.generation.node);
    expect(retry.executions.find(({ kind }) => kind === "generate")).toMatchObject({
      reused: true,
    });
    expect(retry.upscale.node).not.toBeNull();
    expect(retry.upscale.density_satisfied).toBe(true);
    expect(captured).toHaveLength(1);
    expect(fixture.upscaleCalls()).toBe(2);
    const after = await loadActiveDocument(handle, id);
    expect(after?.layers[0]?.maskNodeId).toBe(before?.layers[0]?.maskNodeId);
    expect(
      showDataSchema.parse(success(await command("show", [id]))).preview_info.actual,
    ).toMatchObject({ w: 46, h: 34 });
    expect(
      await command("fill", [
        id,
        "--layer",
        authored.graph.layer,
        "--prompt",
        "generate something different",
      ]),
    ).toMatchObject({ ok: false, code: "usage" });
    expect(captured).toHaveLength(1);
    expect(await loadActiveDocument(handle, id)).toEqual(after);
    expect(
      await command("fill", [
        id,
        "--layer",
        authored.graph.layer,
        "--prompt",
        "continue the scene",
        "--fit",
        "free",
      ]),
    ).toMatchObject({ ok: false, code: "usage" });
    expect(captured).toHaveLength(1);
    expect(await loadActiveDocument(handle, id)).toEqual(after);
  } finally {
    await fixture.close();
  }
});

test("failed outpaint refresh preserves the active snapshot while retaining reusable preparation", async () => {
  const fixture = await refreshFixture();
  const { command, id, handle } = fixture;
  try {
    const authored = fillStrictDataSchema.parse(
      success(
        await command("fill", [
          id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue the scene",
          "--no-upscale",
        ]),
      ),
    );
    expect(await command("develop", [id, "--set", "exposure=1"])).toMatchObject({ ok: true });
    const before = await loadActiveDocument(handle, id);
    fixture.onGeneration(async () => {
      expect(await loadActiveDocument(handle, id)).toEqual(before);
    });
    fixture.replaceGenerationMode("wrongaspect");
    const deterministicIds = async () =>
      (
        await handle.query<{ id: string }>(
          "SELECT id FROM image_nodes WHERE kind NOT IN ('generate', 'upscale') ORDER BY id",
        )
      ).rows;
    expect(await command("layer", ["refresh", id, authored.graph.layer])).toMatchObject({
      ok: false,
    });
    expect(await loadActiveDocument(handle, id)).toEqual(before);
    const retained = await deterministicIds();
    expect(await command("layer", ["refresh", id, authored.graph.layer])).toMatchObject({
      ok: false,
    });
    expect(await loadActiveDocument(handle, id)).toEqual(before);
    expect(await deterministicIds()).toEqual(retained);
    expect(fixture.captured).toHaveLength(3);
  } finally {
    await fixture.close();
  }
});

test("outpaint refresh rejects a source edit during generation through a shared handle", async () => {
  const fixture = await refreshFixture();
  const { command, id, handle } = fixture;
  try {
    const authored = fillStrictDataSchema.parse(
      success(
        await command("fill", [
          id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue the scene",
          "--no-upscale",
        ]),
      ),
    );
    let current: Awaited<ReturnType<typeof loadActiveDocument>>;
    fixture.onGeneration(async () => {
      expect(await command("develop", [id, "--set", "exposure=1"])).toMatchObject({ ok: true });
      current = await loadActiveDocument(handle, id);
    });
    expect(await command("layer", ["refresh", id, authored.graph.layer])).toMatchObject({
      ok: false,
      code: "library_locked",
      data: { reason: "revision_conflict" },
    });
    expect(await loadActiveDocument(handle, id)).toEqual(current!);
    expect((await handle.query<{ id: string }>("SELECT id FROM layers")).rows).toEqual([
      { id: authored.graph.layer },
    ]);
    expect(fixture.captured).toHaveLength(2);
  } finally {
    await fixture.close();
  }
});

test("refresh preserves a moved border's placement and does not expand its authored provider frame", async () => {
  const fixture = await refreshFixture();
  const { command, id, handle, captured } = fixture;
  const delivered = async (name: string) => {
    const response = await command("export", [
      id,
      "--to",
      join(fixture.parent, name),
      "--format",
      "png",
    ]);
    expect(response).toMatchObject({ ok: true });
    const file = exportResultSchema.parse((response as { results: unknown[] }).results[0]).file;
    return await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  try {
    const authored = fillStrictDataSchema.parse(
      success(
        await command("fill", [
          id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue the scene",
          "--no-upscale",
        ]),
      ),
    );
    expect(
      await command("layer", [
        "transform",
        id,
        authored.graph.layer,
        "--dx",
        "4",
        "--anchor",
        "0,0",
      ]),
    ).toMatchObject({ ok: true });
    const before = await loadActiveDocument(handle, id);
    const pixels = await delivered("before");
    expect(pixels.info).toMatchObject({ width: 46, height: 34 });
    expect(await command("layer", ["refresh", id, authored.graph.layer])).toMatchObject({
      ok: true,
    });
    const after = await loadActiveDocument(handle, id);
    expect(after?.layers[0]?.maskNodeId).toBe(before?.layers[0]?.maskNodeId);
    expect(await delivered("after")).toEqual(pixels);
    const shown = showDataSchema.parse(success(await command("show", [id])));
    expect(shown.preview_info.actual).toMatchObject({ w: 46, h: 34 });
    expect(captured).toHaveLength(2);
    expect(captured[1]).toEqual(captured[0]);
  } finally {
    await fixture.close();
  }
});

test("outpaint refresh samples current source edits inside its fixed authored frame", async () => {
  const fixture = await refreshFixture();
  const { command, captured } = fixture;
  try {
    expect(
      await command("develop", [
        fixture.id,
        "--set",
        'crop={"x":4,"y":3,"w":24,"h":16}',
        "--set",
        "rotate=90",
      ]),
    ).toMatchObject({ ok: true });
    const authored = fillStrictDataSchema.parse(
      success(
        await command("fill", [
          fixture.id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue the scene",
          "--no-upscale",
        ]),
      ),
    );
    expect(captured[0]).toMatchObject({ w: 20, h: 28 });
    expect(await command("develop", [fixture.id, "--set", "exposure=1"])).toMatchObject({
      ok: true,
    });
    const refreshed = layerRefreshDataSchema.parse(
      success(await command("layer", ["refresh", fixture.id, authored.graph.layer])),
    );
    expect(refreshed.graph.layer).toBe(authored.graph.layer);
    expect(refreshed.generation.node).not.toBe(authored.generation.node);
    expect(captured).toHaveLength(2);
    expect(captured[1]).toMatchObject({ w: 20, h: 28, mask: captured[0]!.mask });
    const before = captured[0]!.rgb.subarray((2 * 20 + 2) * 3, (2 * 20 + 2) * 3 + 3);
    const after = captured[1]!.rgb.subarray((2 * 20 + 2) * 3, (2 * 20 + 2) * 3 + 3);
    for (let channel = 0; channel < 3; channel++)
      expect(after[channel]).toBeGreaterThan(before[channel]!);
    expect([...captured[1]!.rgb.subarray(0, 3)]).toEqual([0, 0, 0]);
    const shown = showDataSchema.parse(success(await command("show", [fixture.id])));
    expect(shown.preview_info.actual).toMatchObject({ w: 20, h: 28 });
    expect(captured).toHaveLength(2);
  } finally {
    await fixture.close();
  }
});

test("density-only outpaint refresh keeps its pinned generation despite current edits", async () => {
  const fixture = await refreshFixture({ generationMode: "smallerdims" });
  const { command, captured, id } = fixture;
  try {
    const authored = fillStrictDataSchema.parse(
      success(
        await command("fill", [id, "--outpaint", "--px", "2", "--prompt", "continue the scene"]),
      ),
    );
    expect(authored.upscale.node).not.toBeNull();
    expect(fixture.upscaleCalls()).toBe(1);
    expect(await command("develop", [id, "--set", "exposure=1"])).toMatchObject({ ok: true });
    const refreshed = layerRefreshDataSchema.parse(
      success(
        await command("layer", [
          "refresh",
          id,
          authored.graph.layer,
          "--from",
          authored.upscale.node!,
        ]),
      ),
    );
    expect(refreshed.refreshed.kind).toBe("upscale");
    expect(refreshed.generation.node).toBe(authored.generation.node);
    expect(refreshed.upscale.node).not.toBe(authored.upscale.node);
    expect(captured).toHaveLength(1);
    expect(fixture.upscaleCalls()).toBe(2);
    const shown = showDataSchema.parse(success(await command("show", [id])));
    expect(shown.preview_info.actual).toMatchObject({ w: 44, h: 34 });
    expect(captured).toHaveLength(1);
  } finally {
    await fixture.close();
  }
});

test("refresh excludes later photographic paint even after it is reordered below the border", async () => {
  const fixture = await refreshFixture();
  const { command, captured, id } = fixture;
  const author = async () =>
    fillStrictDataSchema.parse(
      success(
        await command("fill", [
          id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue the scene",
          "--no-upscale",
        ]),
      ),
    );
  try {
    await author();
    const b = await author();
    const before = captured[1]!;
    const later = success(
      await command("reimagine", [id, "--prompt", "make a different image"]),
    ) as { layer_id: string };
    expect(await command("layer", ["reorder", id, later.layer_id, "--back"])).toMatchObject({
      ok: true,
    });
    const refreshed = layerRefreshDataSchema.parse(
      success(await command("layer", ["refresh", id, b.graph.layer])),
    );
    expect(refreshed.graph.layer).toBe(b.graph.layer);
    expect(captured).toHaveLength(4);
    expect(captured[3]).toEqual(before);
  } finally {
    await fixture.close();
  }
});

test("removing an authored predecessor does not revive excluded source pixels during refresh", async () => {
  const fixture = await refreshFixture();
  const { command, captured, id } = fixture;
  const author = async () =>
    fillStrictDataSchema.parse(
      success(
        await command("fill", [
          id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue the scene",
          "--no-upscale",
        ]),
      ),
    );
  try {
    expect(
      await command("develop", [id, "--set", 'crop={"x":4,"y":3,"w":24,"h":16}']),
    ).toMatchObject({ ok: true });
    const a = await author();
    const b = await author();
    const before = captured[1]!;
    expect(before).toMatchObject({ w: 32, h: 24 });
    const corner = (2 * 32 + 2) * 3;
    expect([...before.rgb.subarray(corner, corner + 3)]).not.toEqual([0, 0, 0]);
    expect(await command("develop", [id, "--unset", "crop"])).toMatchObject({ ok: true });
    expect(await command("layer", ["remove", id, a.graph.layer])).toMatchObject({ ok: true });
    const refreshed = layerRefreshDataSchema.parse(
      success(await command("layer", ["refresh", id, b.graph.layer])),
    );
    expect(refreshed.graph.layer).toBe(b.graph.layer);
    expect(captured).toHaveLength(3);
    const after = captured[2]!;
    expect(after).toMatchObject({ w: 32, h: 24, mask: before.mask });
    expect([...after.rgb.subarray(corner, corner + 3)]).toEqual([0, 0, 0]);
    const interior = (4 * 32 + 4) * 3;
    expect(after.rgb.subarray(interior, interior + 3)).toEqual(
      before.rgb.subarray(interior, interior + 3),
    );
    const shown = showDataSchema.parse(success(await command("show", [id])));
    expect(shown.preview_info.actual).toMatchObject({ w: 32, h: 24 });
    expect(captured).toHaveLength(3);
  } finally {
    await fixture.close();
  }
});

test("refresh samples an authored predecessor's current enabled state and opacity", async () => {
  const fixture = await refreshFixture();
  const { command, id, captured } = fixture;
  const author = async () =>
    fillStrictDataSchema.parse(
      success(
        await command("fill", [
          id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue the scene",
          "--no-upscale",
        ]),
      ),
    );
  try {
    const a = await author();
    const b = await author();
    const corner = (2 * 48 + 2) * 3;
    const original = captured[1]!.rgb.subarray(corner, corner + 3);
    expect([...original]).not.toEqual([0, 0, 0]);
    expect(await command("layer", ["set", id, a.graph.layer, "--enabled", "false"])).toMatchObject({
      ok: true,
    });
    expect(await command("layer", ["refresh", id, b.graph.layer])).toMatchObject({ ok: true });
    expect([...captured[2]!.rgb.subarray(corner, corner + 3)]).toEqual([0, 0, 0]);
    expect(
      await command("layer", ["set", id, a.graph.layer, "--enabled", "true", "--opacity", "0.5"]),
    ).toMatchObject({ ok: true });
    expect(await command("layer", ["refresh", id, b.graph.layer])).toMatchObject({ ok: true });
    const half = captured[3]!.rgb.subarray(corner, corner + 3);
    for (let channel = 0; channel < 3; channel++) {
      expect(half[channel]).toBeGreaterThan(0);
      expect(half[channel]).toBeLessThan(original[channel]!);
    }
    expect(captured).toHaveLength(4);
  } finally {
    await fixture.close();
  }
});
