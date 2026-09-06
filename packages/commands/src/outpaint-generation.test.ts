import { initializeLibrary } from "@photoctl/library";
import { GatewayClient, GatewayImageModelAdapter } from "@photoctl/providers";
import {
  loadActiveDocument,
  describeFillBranch,
  normalizeMaskArtifact,
  artifactPath,
} from "@photoctl/render";
import { showDataSchema, exportResultSchema, outpaintDataSchema } from "@photoctl/protocol";
import { fillStrictDataSchema } from "@photoctl/protocol";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";
import { fillUpscaleFixture, fixtureCommand, success } from "./fill-upscale-fixture.js";

test("outpaint finalizes a retained paid attempt when exterior publication fails", async () => {
  const fixture = await fillUpscaleFixture();
  try {
    const data = new Float32Array(44 * 34).fill(1);
    for (let y = 2; y < 32; y++) data.fill(0, y * 44 + 2, y * 44 + 42);
    const mask = await normalizeMaskArtifact({ w: 44, h: 34, data });
    await mkdir(artifactPath(fixture.handle.path, mask.artifactHash, mask.extension), {
      recursive: true,
    });
    expect(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--outpaint",
        "--px",
        "2",
        "--prompt",
        "continue the scene",
        "--no-upscale",
      ]),
    ).toMatchObject({ ok: false });
    expect(fixture.generationCalls()).toBe(1);
    expect(await loadActiveDocument(fixture.handle, fixture.id)).toBeNull();
    const attempts = await fixture.handle.query(
      "SELECT state, original_artifact_hash FROM provider_image_attempts",
    );
    expect(attempts.rows).toEqual([
      { state: "failed", original_artifact_hash: expect.stringMatching(/^a_[a-f0-9]{64}$/) },
    ]);
  } finally {
    await fixture.close();
  }
});

test("outpaint keeps usable generation and its extent when configured upscaling fails", async () => {
  const fixture = await fillUpscaleFixture({
    generationMode: "smallerdims",
    upscaleMode: "transport-failure",
  });
  try {
    const result = fillStrictDataSchema.parse(
      success(
        await fixtureCommand(fixture, "fill", [
          fixture.id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue the scene",
        ]),
      ),
    );
    expect(result.upscale).toMatchObject({
      enabled: true,
      executed: false,
      node: null,
      density_satisfied: false,
      warnings: [{ code: "upscale_failed" }],
    });
    expect(result.generation.returned).toEqual({ w: 22, h: 17 });
    const document = await loadActiveDocument(fixture.handle, fixture.id);
    expect(document?.layers.map(({ id, role }) => ({ id, role }))).toEqual([
      { id: result.graph.layer, role: "border" },
    ]);
    const shown = showDataSchema.parse(
      success(await fixtureCommand(fixture, "show", [fixture.id])),
    );
    expect(shown.preview_info.actual).toMatchObject({ w: 44, h: 34 });
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(1);
  } finally {
    await fixture.close();
  }
});

test.each([true, false])(
  "outpaint sends the source in an exterior-only frame and activates one border (edited=%s)",
  async (edited) => {
    const parent = await mkdtemp(join(tmpdir(), "photoctl-outpaint-generation-"));
    const { handle } = await initializeLibrary(join(parent, "library"));
    const captured: Array<{ w: number; h: number; rgb: Buffer; mask: Buffer }> = [];
    let outputMode: "normal" | "corrupt" | "aspect" = "normal";
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const form = await new Request("http://fixture/images/edits", {
          method: "POST",
          headers: { "content-type": request.headers["content-type"]! },
          body: Buffer.concat(chunks),
        }).formData();
        const image = await sharp(Buffer.from(await (form.get("image") as File).arrayBuffer()))
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const mask = await sharp(Buffer.from(await (form.get("mask") as File).arrayBuffer()))
          .extractChannel(0)
          .raw()
          .toBuffer();
        captured.push({ w: image.info.width, h: image.info.height, rgb: image.data, mask });
        const png =
          outputMode === "corrupt"
            ? Buffer.from("not an image")
            : await sharp({
                create: {
                  width: image.info.width + (outputMode === "aspect" ? 4 : 0),
                  height: image.info.height,
                  channels: 3,
                  background: "#2468ac",
                },
              })
                .png()
                .toBuffer();
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
      })().catch((error) => {
        response.writeHead(500);
        response.end(String(error));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No fixture address");
      const context = {
        version: "test",
        library: handle,
        fill: {
          model: "openai/gpt-image-2",
          adapter: new GatewayImageModelAdapter({
            model: "openai/gpt-image-2",
            mask: "native",
            maskPolarity: "white-edits",
          }),
          gateway: new GatewayClient({
            apiKey: "fixture",
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
          }),
        },
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
          context,
        );
      const command = async (verb: string, args: string[]) => {
        const result = await response(verb, args);
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
        if (!result.ok) throw new Error("Expected success");
        return "data" in result ? result.data : result;
      };
      const pixels = Buffer.alloc(8 * 6 * 3);
      for (let y = 0; y < 6; y++)
        for (let x = 0; x < 8; x++) {
          pixels.set([x * 32, y * 32, 64], (y * 8 + x) * 3);
        }
      const source = join(parent, "source.png");
      await sharp(pixels, { raw: { width: 8, height: 6, channels: 3 } })
        .png()
        .toFile(source);
      const id = ((await command("import", [source, "--link"])) as { ids: string[] }).ids[0]!;
      if (edited)
        await command("develop", [
          id,
          "--set",
          'crop={"x":2,"y":1,"w":4,"h":3}',
          "--set",
          "rotate=90",
        ]);
      const before = await loadActiveDocument(handle, id);
      const nodesBefore = (
        await handle.query("SELECT id FROM image_nodes WHERE photo_id = $1 ORDER BY id", [id])
      ).rows;
      if (!edited) {
        expect(
          outpaintDataSchema.parse(
            await command("fill", [
              id,
              "--outpaint",
              "--aspect",
              "4:3",
              "--prompt",
              "continue the scene",
              "--no-upscale",
            ]),
          ),
        ).toEqual({ id, changed: false, layer_id: null, revision_id: null, render_hash: null });
        expect(
          (await handle.query("SELECT id FROM image_nodes WHERE photo_id = $1 ORDER BY id", [id]))
            .rows,
        ).toEqual(nodesBefore);
      }
      for (const invalid of [
        ["--outpaint", "--px", "-1"],
        ["--outpaint", "--px", "2", "--aspect", "1:1"],
        ["--outpaint", "--px", "2", "--layer", "missing"],
        ["--outpaint", "--px", "10000000"],
        ["--outpaint", "--px", "2", "--fit", "free"],
        ["--layer", "missing", "--px", "2"],
      ]) {
        expect(
          await response("fill", [
            id,
            ...invalid,
            "--prompt",
            "continue the scene",
            "--no-upscale",
          ]),
        ).toMatchObject({ ok: false, code: "usage" });
        expect(await loadActiveDocument(handle, id)).toEqual(before);
        expect(captured).toEqual([]);
      }
      let preparedNodes: Array<{ id: string; kind: string }> | undefined;
      for (const invalid of ["corrupt", "aspect"] as const) {
        outputMode = invalid;
        expect(
          await response("fill", [
            id,
            "--outpaint",
            "--px",
            "2",
            "--prompt",
            "continue the scene",
            "--no-upscale",
          ]),
        ).toMatchObject({ ok: false });
        expect(await loadActiveDocument(handle, id)).toEqual(before);
        const retained = (
          await handle.query<{ id: string; kind: string }>(
            "SELECT id, kind FROM image_nodes WHERE photo_id = $1 ORDER BY id",
            [id],
          )
        ).rows;
        expect(retained.every(({ kind }) => kind !== "generate" && kind !== "upscale")).toBe(true);
        if (preparedNodes) expect(retained).toEqual(preparedNodes);
        preparedNodes = retained;
      }
      outputMode = "normal";
      await command("fill", [
        id,
        "--outpaint",
        "--px",
        "2",
        "--prompt",
        "continue the scene",
        "--no-upscale",
      ]);
      expect(captured).toHaveLength(3);
      expect(captured[0]).toEqual(captured[1]);
      expect(captured[1]).toEqual(captured[2]);
      const sent = captured[2]!;
      const [width, height] = edited ? [7, 8] : [12, 10];
      expect([sent.w, sent.h]).toEqual([width, height]);
      for (let y = 0; y < height!; y++)
        for (let x = 0; x < width!; x++) {
          const interior = x >= 2 && x < width! - 2 && y >= 2 && y < height! - 2;
          expect(sent.mask[y * width! + x]).toBe(interior ? 0 : 255);
          if (!interior)
            expect([...sent.rgb.subarray((y * width! + x) * 3, (y * width! + x) * 3 + 3)]).toEqual([
              0, 0, 0,
            ]);
        }
      for (const [x, y, red, green] of edited
        ? [
            [2, 2, 64, 96],
            [4, 5, 160, 32],
          ]
        : [
            [2, 2, 0, 0],
            [9, 7, 224, 160],
          ]) {
        const sample = sent.rgb.subarray((y! * width! + x!) * 3, (y! * width! + x!) * 3 + 3);
        for (const [channel, expected] of [red!, green!, 64].entries())
          expect(Math.abs(sample[channel]! - expected)).toBeLessThanOrEqual(2);
      }
      const after = await loadActiveDocument(handle, id);
      expect(after?.revisionId).not.toBe(before?.revisionId);
      expect(after?.layers.map(({ role, name }) => ({ role, name }))).toEqual([
        { role: "border", name: "Outpaint" },
      ]);
      const shown = showDataSchema.parse(await command("show", [id]));
      expect(shown.preview_info.actual).toMatchObject({ w: width, h: height });
      const exported = await response("export", [
        id,
        "--to",
        join(parent, "delivery"),
        "--format",
        "png",
      ]);
      expect(exported).toMatchObject({ ok: true });
      const delivery = exportResultSchema.parse((exported as { results: unknown[] }).results[0]);
      expect(delivery).toMatchObject({
        w: width,
        h: height,
        render_hash: shown.preview_info.render_hash,
      });
      const delivered = await sharp(delivery.file)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect([delivered.info.width, delivered.info.height]).toEqual([width, height]);
      for (let y = 0; y < height!; y++)
        for (let x = 0; x < width!; x++) {
          const interior = x >= 2 && x < width! - 2 && y >= 2 && y < height! - 2;
          const offset = (y * width! + x) * 3;
          const expected = interior ? sent.rgb.subarray(offset, offset + 3) : [36, 104, 172];
          for (let channel = 0; channel < 3; channel++)
            expect(
              Math.abs(delivered.data[offset + channel]! - expected[channel]!),
            ).toBeLessThanOrEqual(2);
        }
      expect(await describeFillBranch(handle, id, after!.layers[0]!)).toMatchObject({
        frame: { w: width, h: height },
      });
      expect(captured).toHaveLength(3);
      expect(
        await response("fill", [
          id,
          "--layer",
          after!.layers[0]!.id,
          "--prompt",
          "continue the scene",
          "--no-upscale",
        ]),
      ).toMatchObject({ ok: true });
      expect((await loadActiveDocument(handle, id))?.renderHash).toBe(after?.renderHash);
      expect((await loadActiveDocument(handle, id))?.layers[0]?.maskNodeId).toBe(
        after?.layers[0]?.maskNodeId,
      );
      expect(captured).toHaveLength(3);
      expect(
        await response("fill", [
          id,
          "--layer",
          after!.layers[0]!.id,
          "--px",
          "1",
          "--prompt",
          "continue the scene",
          "--no-upscale",
        ]),
      ).toMatchObject({ ok: false, code: "usage" });
      expect((await loadActiveDocument(handle, id))?.renderHash).toBe(after?.renderHash);
      expect(
        await command("fill", [
          id,
          "--outpaint",
          "--aspect",
          `${width}:${height}`,
          "--prompt",
          "continue the scene",
          "--no-upscale",
        ]),
      ).toMatchObject({ changed: false });
      expect((await loadActiveDocument(handle, id))?.renderHash).toBe(after?.renderHash);
      expect(captured).toHaveLength(3);
      await command("layer", [
        "transform",
        id,
        after!.layers[0]!.id,
        edited ? "--dy" : "--dx",
        edited ? "-4" : "4",
        "--anchor",
        "0,0",
      ]);
      const moved = showDataSchema.parse(await command("show", [id]));
      expect(moved.preview_info.actual).toMatchObject({ w: width! + 2, h: height });
      const movedExport = await response("export", [
        id,
        "--to",
        join(parent, "moved"),
        "--format",
        "png",
      ]);
      expect(movedExport).toMatchObject({ ok: true });
      const movedDelivery = exportResultSchema.parse(
        (movedExport as { results: unknown[] }).results[0],
      );
      const movedPixels = await sharp(movedDelivery.file).removeAlpha().raw().toBuffer();
      const sourceSample = sent.rgb.subarray((2 * width! + 2) * 3, (2 * width! + 2) * 3 + 3);
      for (let channel = 0; channel < 3; channel++) {
        expect(
          Math.abs(movedPixels[2 * (width! + 2) * 3 + channel]! - sourceSample[channel]!),
        ).toBeLessThanOrEqual(2);
        expect(
          Math.abs(
            movedPixels[(3 * (width! + 2) + width! + 1) * 3 + channel]! - [36, 104, 172][channel]!,
          ),
        ).toBeLessThanOrEqual(2);
      }
      expect(captured).toHaveLength(3);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await handle.close();
      await rm(parent, { recursive: true, force: true });
    }
  },
);
