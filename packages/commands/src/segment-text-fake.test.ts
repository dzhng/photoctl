import { initializeLibrary } from "@photoctl/library";
import { segmentInstancesDataSchema } from "@photoctl/protocol";
import {
  loadActiveDocument,
  rasterizeManualMask,
  ZimSegmenter,
  readArtifactMask,
  artifactPath,
} from "@photoctl/render";
import { cacheRootForLibrary, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import sharp from "sharp";
import type { GroundedInstance, StructuredModelAdapter } from "@photoctl/providers";
import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { dispatch, type SegmentationAdapter } from "./dispatch.js";

const directories: string[] = [];
const groundingPoints: GroundedInstance["points"] = Array.from({ length: 12 }, (_, index) => ({
  at: [1, 1],
  label: index < 5 ? 1 : 0,
}));

test.each([
  { existing: false, text: false },
  { existing: true, text: false },
  { existing: false, text: true },
  { existing: true, text: true },
])(
  "segmentation rejects a revision changed during inference through a shared handle (%j)",
  async ({ existing, text }) => {
    const fixture = await fixtureLibrary("stale-inference");
    const request = (verb: string, args: string[]) => ({
      verb,
      args,
      cwd: fixture.parent,
      env: { noDaemon: true },
    });
    const context = { version: "test", library: fixture.handle };
    const expectedLayerIds: string[] = [];
    let expectedActive: { revisionId: string; renderHash: string } | undefined;
    const addManual = async (box: string) => {
      const result = await dispatch(request("segment", [fixture.id, "--box", box]), context);
      expect(result).toMatchObject({ ok: true });
      if (!result.ok || !("data" in result)) throw new Error("manual selection failed");
      const data = result.data as { layer_id: string; revision_id: string; render_hash: string };
      expectedLayerIds.push(data.layer_id);
      expectedActive = { revisionId: data.revision_id, renderHash: data.render_hash };
    };
    try {
      if (existing) await addManual("0,0,2,2");
      const response = await dispatch(
        request("segment", [fixture.id, "--at", "3,2", ...(text ? ["--text", "person"] : [])]),
        {
          ...context,
          segmentation: {
            ...(text
              ? {
                  structured: cannedGrounding([{ label: "person", box_2d: [0, 0, 8, 6] }]),
                  image: {
                    bytes: Buffer.from("jpeg"),
                    mediaType: "image/jpeg" as const,
                    dimensions: { w: 8, h: 6 },
                  },
                }
              : {}),
            local: {
              segment: async ({ dimensions }) => {
                await addManual("4,2,2,2");
                return {
                  ...dimensions,
                  data: new Float32Array(dimensions.w * dimensions.h).fill(1),
                };
              },
            },
          },
        },
      );
      expect(response).toMatchObject({
        ok: false,
        code: "library_locked",
        data: { reason: "revision_conflict" },
      });
      const layers = await fixture.handle.query<{ id: string }>("SELECT id FROM layers");
      expect(layers.rows.map(({ id }) => id).sort()).toEqual([...expectedLayerIds].sort());
      const active = await loadActiveDocument(fixture.handle, fixture.id);
      expect(active).toMatchObject(expectedActive!);
      expect(active?.layers.map(({ id }) => id)).toEqual(expectedLayerIds);
    } finally {
      await fixture.handle.close();
    }
  },
);

test("slow segmentation initialization reports progress before inference can proceed", async () => {
  const fixture = await fixtureLibrary("slow-initialization");
  let reports = 0;
  let release = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const cacheRoot = await pinFixture(fixture);
    const result = await dispatch(
      {
        verb: "segment",
        args: [fixture.id, "--at", "3,2", "--dry-run"],
        cwd: fixture.parent,
        env: { noDaemon: true, cacheRoot },
      },
      {
        version: "test",
        library: fixture.handle,
        emit: (event) => {
          if (event.event === "progress" && event.done === 0) {
            reports++;
            if (reports === 2) release();
          }
        },
        segmenter: new ZimSegmenter(async () => {
          await new Promise<void>((resolve, reject) => {
            release = resolve;
            timer = setTimeout(
              () => reject(new Error("No progress while model initialization was pending")),
              6_000,
            );
          });
          return {
            encoderInputNames: () => [],
            decoderInputNames: () => [],
            runEncoder: async () =>
              [
                [1, 256, 64, 64],
                [1, 64, 512, 512],
                [1, 128, 256, 256],
                [1, 256, 128, 128],
              ].map((dimensions) => ({
                dimensions,
                data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
              })),
            runDecoder: async () => [
              { dimensions: [1, 4, 512, 512], data: new Float32Array(4 * 512 * 512).fill(1000) },
              { dimensions: [1, 4], data: new Float32Array([1, 0, 0, 0]) },
            ],
          };
        }),
      },
    );
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    expect(reports).toBeGreaterThanOrEqual(2);
  } finally {
    clearTimeout(timer);
    release();
    await fixture.handle.close();
  }
}, 10_000);

test("failed local initialization emits runtime diagnostics through command stderr events", async () => {
  const fixture = await fixtureLibrary("runtime-diagnostic");
  const events: unknown[] = [];
  try {
    const segmenter = new ZimSegmenter(async (diagnostics) => {
      diagnostics?.({
        diagnostics: [
          {
            scope: "runtime",
            severity: "warning",
            codeLocation: "cpu.cc:1",
            message: "Unknown CPU vendor",
            truncated: false,
          },
        ],
        droppedDiagnostics: 2,
      });
      throw new Error("invalid SAM decoder");
    });
    const response = await dispatch(
      {
        verb: "segment",
        args: [fixture.id, "--at", "1,1"],
        cwd: fixture.parent,
        env: { noDaemon: true },
      },
      {
        version: "test",
        library: fixture.handle,
        segmenter,
        emit: (event) => {
          if (event.event === "warn") events.push(event);
        },
      },
    );
    expect(response.ok).toBe(false);
    expect(events).toEqual([
      {
        event: "warn",
        code: "runtime_warning",
        message: "[runtime warning] Unknown CPU vendor (cpu.cc:1)",
      },
      {
        event: "warn",
        code: "runtime_warning",
        message:
          "Native runtime diagnostics exceeded their retention limit; 2 messages were dropped",
      },
    ]);
  } finally {
    await fixture.handle.close();
  }
});

test("empty production grounding preserves JPEG bytes without encoding or evicting features", async () => {
  const fixture = await fixtureLibrary("empty-production");
  let jpegHash: string | undefined;
  let encodes = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const encoded = Buffer.concat(chunks)
        .toString()
        .match(/data:image\/jpeg;base64,([^"\\]+)/)?.[1];
      jpegHash = encoded
        ? createHash("sha256").update(Buffer.from(encoded, "base64")).digest("hex")
        : undefined;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: '{"instances":[]}' } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const cacheRoot = await pinFixture(fixture);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No fixture port");
    const segmenter = new ZimSegmenter(
      async () => ({
        encoderInputNames: () => [],
        decoderInputNames: () => [],
        runEncoder: async () => {
          encodes++;
          return [
            [1, 256, 64, 64],
            [1, 64, 512, 512],
            [1, 128, 256, 256],
            [1, 256, 128, 128],
          ].map((dimensions) => ({
            dimensions,
            data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
          }));
        },
        runDecoder: async () => [
          { dimensions: [1, 4, 512, 512], data: new Float32Array(4 * 512 * 512).fill(1000) },
          { dimensions: [1, 4], data: new Float32Array([1, 0, 0, 0]) },
        ],
      }),
      1,
    );
    const env = {
      noDaemon: true,
      cacheRoot,
      gatewayApiKey: "fixture-key",
      gatewayUrl: `http://127.0.0.1:${address.port}`,
    };
    const context = { version: "test", library: fixture.handle, segmenter };
    const select = () =>
      dispatch(
        {
          verb: "segment",
          args: [fixture.id, "--at", "1,1", "--dry-run"],
          cwd: fixture.parent,
          env,
        },
        context,
      );
    expect(await select()).toMatchObject({
      ok: true,
      data: { instances: [{ mask: { pixels: 48 } }] },
    });
    expect(encodes).toBe(1);
    const otherId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c156";
    await fixture.handle.query(
      "WITH seed (id, content_key, size, w, h, orientation) AS (VALUES ($1,'ck_empty_second',1,8,6,1)), inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation) SELECT id::uuid, id::uuid, w::integer, h::integer, orientation::integer FROM seed RETURNING id) INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation) SELECT id::uuid, id::uuid, 'image', content_key, size::bigint, w::integer, h::integer, orientation::integer FROM seed",
      [otherId],
    );
    await pinFixture({ ...fixture, id: otherId });
    const response = await dispatch(
      { verb: "segment", args: [otherId, "--text", "absent"], cwd: fixture.parent, env },
      context,
    );
    expect(response).toMatchObject({
      ok: true,
      data: { instances: [], revision_id: null, gateway_calls: 1 },
    });
    expect(encodes).toBe(1);
    expect(jpegHash).toBe("3191d767d9b33118252c00a322441de44882a5e339606163381aee50a04ce417");
    expect(await select()).toMatchObject({
      ok: true,
      data: { instances: [{ mask: { pixels: 48 } }] },
    });
    expect(encodes).toBe(1);
    expect((await fixture.handle.query("SELECT id FROM document_revisions")).rows).toEqual([]);
  } finally {
    await fixture.handle.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("production text guidance preserves polarity through a rotated crop and click-tests projected base alpha", async () => {
  const fixture = await fixtureLibrary("grounded-production");
  let groundingCalls = 0;
  const server = createServer((_request, response) => {
    groundingCalls += 1;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                instances: [
                  {
                    label: "person",
                    box_2d: [0, 0, 1000, 1000],
                    points: groundingPoints.map(({ label }) => ({
                      label,
                      at: label ? [333, 250] : [667, 750],
                    })),
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const cacheRoot = await pinFixture(fixture);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No fixture port");
    const env = {
      noDaemon: true,
      cacheRoot,
      gatewayApiKey: "fixture-key",
      gatewayUrl: `http://127.0.0.1:${address.port}`,
    };
    const context = {
      version: "test",
      library: fixture.handle,
      segmenter: new ZimSegmenter(async () => ({
        encoderInputNames: () => [],
        decoderInputNames: () => [],
        runEncoder: async () =>
          [
            [1, 256, 64, 64],
            [1, 64, 512, 512],
            [1, 128, 256, 256],
            [1, 256, 128, 128],
          ].map((dimensions) => ({
            dimensions,
            data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
          })),
        runDecoder: async (inputs) => {
          expect([...inputs.find((input) => input.name === "point_labels")!.f32Data!]).toEqual([
            1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, -1,
          ]);
          expect([...inputs.find((input) => input.name === "point_coords")!.f32Data!]).toEqual([
            ...Array.from({ length: 5 }, () => [256, 256]).flat(),
            ...Array.from({ length: 7 }, () => [512, 768]).flat(),
            -0.5,
            -0.5,
          ]);
          return [
            { dimensions: [1, 4, 512, 512], data: new Float32Array(4 * 512 * 512).fill(1000) },
            { dimensions: [1, 4], data: new Float32Array([1, 0, 0, 0]) },
          ];
        },
      })),
    };
    expect(
      await dispatch(
        {
          verb: "develop",
          args: [fixture.id, "--set", 'crop={"x":2,"y":1,"w":4,"h":3}', "--set", "rotate=90"],
          cwd: fixture.parent,
          env,
        },
        context,
      ),
    ).toMatchObject({ ok: true });
    const prototype = Object.getPrototypeOf(sharp()) as {
      resize: ReturnType<typeof sharp>["resize"];
    };
    const resize = prototype.resize;
    prototype.resize = () => {
      throw new Error("Sharp must not resample grounding pixels");
    };
    let result;
    try {
      result = await dispatch(
        {
          verb: "segment",
          args: [fixture.id, "--text", "person", "--at", "3,1"],
          cwd: fixture.parent,
          env,
        },
        context,
      );
    } finally {
      prototype.resize = resize;
    }
    expect(result).toMatchObject({
      ok: true,
      data: {
        gateway_calls: 1,
        instances: [{ label: "person", bbox: [2, 1, 4, 3], mask: { pixels: 12 } }],
      },
    });
    const revision = (await loadActiveDocument(fixture.handle, fixture.id))!.revisionId;
    expect(
      await dispatch(
        {
          verb: "segment",
          args: [fixture.id, "--text", "person", "--at", "0,0"],
          cwd: fixture.parent,
          env,
        },
        context,
      ),
    ).toMatchObject({ ok: false, code: "usage" });
    expect(groundingCalls).toBe(1);
    expect((await loadActiveDocument(fixture.handle, fixture.id))!.revisionId).toBe(revision);
    expect(
      await dispatch({ verb: "show", args: [fixture.id], cwd: fixture.parent, env }, context),
    ).toMatchObject({ ok: true });
  } finally {
    await fixture.handle.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

async function pinFixture(fixture: Awaited<ReturnType<typeof fixtureLibrary>>) {
  const libraryId = (
    await fixture.handle.query<{ value: string }>(
      "SELECT value #>> '{}' AS value FROM settings WHERE key = 'library_id'",
    )
  ).rows[0]!.value;
  const cacheRoot = join(fixture.parent, "cache");
  const path = pinnedEmbeddedJpegPath(cacheRootForLibrary(libraryId, cacheRoot), fixture.id);
  await mkdir(dirname(path), { recursive: true });
  await sharp({ create: { width: 8, height: 6, channels: 3, background: "#aa2233" } })
    .jpeg()
    .toFile(path);
  return cacheRoot;
}

test("default command adapter segments pinned develop pixels and dry-run leaves graph rows untouched", async () => {
  const fixture = await fixtureLibrary("production");
  try {
    const cacheRoot = await pinFixture(fixture);
    await fixture.handle.query("UPDATE photos SET w=16,h=12 WHERE id=$1", [fixture.id]);
    let encodes = 0;
    const segmenter = new ZimSegmenter(async () => ({
      encoderInputNames: () => [],
      decoderInputNames: () => [],
      runEncoder: async () => {
        encodes++;
        return [
          [1, 256, 64, 64],
          [1, 64, 512, 512],
          [1, 128, 256, 256],
          [1, 256, 128, 128],
        ].map((dimensions) => ({
          dimensions,
          data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
        }));
      },
      runDecoder: async () => [
        { dimensions: [1, 4, 512, 512], data: new Float32Array(4 * 512 * 512).fill(1000) },
        { dimensions: [1, 4], data: new Float32Array([1, 0, 0, 0]) },
      ],
    }));
    const request = {
      verb: "segment",
      args: [fixture.id, "--at", "3,2", "--dry-run"],
      cwd: fixture.parent,
      env: { noDaemon: true, cacheRoot },
    };
    const context = { version: "test", library: fixture.handle, segmenter };
    expect(await dispatch(request, context)).toMatchObject({
      ok: true,
      data: { instances: [{ bbox: [0, 0, 16, 12], mask: { pixels: 192 } }] },
    });
    expect(await dispatch(request, context)).toMatchObject({ ok: true });
    expect(encodes).toBe(1);
    await Promise.all(
      ["document_revisions", "image_nodes", "node_executions", "layers"].map(async (table) =>
        expect((await fixture.handle.query(`SELECT * FROM ${table}`)).rows).toEqual([]),
      ),
    );
    expect(
      await dispatch({ ...request, args: [fixture.id, "--at", "3,2"] }, context),
    ).toMatchObject({
      ok: true,
      data: { instances: [{ layer_id: expect.any(String), mask: { pixels: 192 } }] },
    });
    expect((await fixture.handle.query("SELECT name FROM document_revision_layers")).rows).toEqual([
      { name: "Segment" },
    ]);
    expect(await dispatch({ ...request, verb: "show", args: [fixture.id] }, context)).toMatchObject(
      { ok: true },
    );
  } finally {
    await fixture.handle.close();
  }
});

test("production segmentation reports missing model files before touching the document", async () => {
  const fixture = await fixtureLibrary("release");
  try {
    const response = await dispatch(
      {
        verb: "segment",
        args: [fixture.id, "--at", "1,1", "--dry-run"],
        cwd: fixture.parent,
        env: { noDaemon: true },
      },
      { version: "test", library: fixture.handle },
    );
    expect(response).toMatchObject({
      ok: false,
      code: "provider_unconfigured",
      data: { reason: "model_missing" },
    });
    expect((await fixture.handle.query("SELECT id FROM document_revisions")).rows).toEqual([]);
  } finally {
    await fixture.handle.close();
  }
});

test("segmentation uses the catalog's already-oriented portrait dimensions", async () => {
  const fixture = await fixtureLibrary("portrait");
  try {
    await fixture.handle.query("UPDATE photos SET orientation = 6 WHERE id = $1", [fixture.id]);
    const response = await dispatch(
      {
        verb: "segment",
        args: [fixture.id, "--at", "7,5", "--dry-run"],
        cwd: fixture.parent,
        env: { noDaemon: true },
      },
      {
        version: "test",
        library: fixture.handle,
        segmentation: {
          local: {
            segment: async ({ dimensions }) => ({
              ...dimensions,
              data: new Float32Array(dimensions.w * dimensions.h).fill(1),
            }),
          },
        },
      },
    );
    expect(response).toMatchObject({ ok: true, data: { instances: [{ bbox: [0, 0, 8, 6] }] } });
  } finally {
    await fixture.handle.close();
  }
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("text preserves each instance's signed guidance and saves fractional coverage without its locating box", async () => {
  const fixture = await fixtureLibrary("signed-text");
  const points: GroundedInstance["points"] = [
    { at: [1, 1], label: 1 },
    { at: [2, 1], label: 1 },
    { at: [1, 2], label: 1 },
    { at: [2, 2], label: 1 },
    { at: [3, 2], label: 1 },
    { at: [0, 0], label: 0 },
    { at: [3, 1], label: 0 },
    { at: [4, 1], label: 0 },
    { at: [4, 2], label: 0 },
    { at: [5, 3], label: 0 },
    { at: [6, 4], label: 0 },
    { at: [7, 5], label: 0 },
  ];
  try {
    const response = await dispatch(
      {
        verb: "segment",
        args: [fixture.id, "--text", "patterned fabric"],
        cwd: fixture.parent,
        env: { noDaemon: true },
      },
      {
        version: "test",
        library: fixture.handle,
        segmentation: {
          structured: cannedGrounding([{ label: "fabric", box_2d: [0, 0, 8, 6], points }]),
          image: {
            bytes: Buffer.from("jpeg"),
            mediaType: "image/jpeg",
            dimensions: { w: 8, h: 6 },
          },
          local: {
            segment: async ({ dimensions, points: guidance, box }) => {
              if (box) return rasterizeManualMask(dimensions, { kind: "box", bbox: box }).mask;
              const data = new Float32Array(dimensions.w * dimensions.h);
              for (const {
                at: [x, y],
                label,
              } of guidance)
                data[y * dimensions.w + x] = label ? 0.75 : 0;
              return { ...dimensions, data };
            },
          },
        },
      },
    );
    expect(response).toMatchObject({
      ok: true,
      data: { instances: [{ label: "fabric", mask: { pixels: 5, bbox: [1, 1, 3, 2] } }] },
    });
    if (!response.ok) throw new Error("segment failed");
    const hash = segmentInstancesDataSchema.parse(response.data).instances[0]!.mask.artifact_hash!;
    const saved = await readArtifactMask(artifactPath(fixture.handle.path, hash, "tif"), hash);
    expect(saved.data[1 * 8 + 1]).toBe(0.75);
    expect(saved.data[1 * 8 + 3]).toBe(0);
  } finally {
    await fixture.handle.close();
  }
});

test("text clicks select actual alpha at the floored base pixel despite overlapping instance boxes", async () => {
  const left = new Float32Array(48).fill(0.1);
  const right = new Float32Array(48).fill(0.1);
  left[1 * 8 + 1] = 0.9;
  left[3 * 8 + 6] = 0.49;
  right[3 * 8 + 6] = 0.5;
  const fixture = await groundedMaskFixture("alpha-click", [left, right]);
  try {
    const response = await fixture.select(["--at", "6.9,3.1"]);
    expect(response).toMatchObject({
      ok: true,
      data: { instances: [{ i: 0, label: "subject 2", mask: { pixels: 48 } }] },
    });
    if (!response.ok) throw new Error("segment failed");
    expect(
      segmentInstancesDataSchema.parse(response.data).instances.map((instance) => instance.label),
    ).toEqual(["subject 2"]);
    const hash = segmentInstancesDataSchema.parse(response.data).instances[0]!.mask.artifact_hash!;
    expect(
      (await readArtifactMask(artifactPath(fixture.handle.path, hash, "tif"), hash)).data,
    ).toEqual(right);
    expect(
      (await fixture.handle.query("SELECT name FROM document_revision_layers ORDER BY z")).rows,
    ).toEqual([{ name: "subject 2" }]);
  } finally {
    await fixture.handle.close();
  }
});

test.each([false, true])(
  "text rejects an ambiguous actual mask hit without a revision (dryRun=%s)",
  async (dryRun) => {
    const first = new Float32Array(48);
    const second = new Float32Array(48);
    first[2 * 8 + 3] = 0.8;
    second[2 * 8 + 3] = 0.5;
    const fixture = await groundedMaskFixture("ambiguous-click", [first, second]);
    try {
      const response = await fixture.select(["--at", "3,2", ...(dryRun ? ["--dry-run"] : [])]);
      expect(response).toMatchObject({
        ok: false,
        code: "usage",
        data: {
          reason: "ambiguous_match",
          point: [3, 2],
          message: expect.stringContaining("multiple"),
        },
      });
      expect((await fixture.handle.query("SELECT id FROM document_revisions")).rows).toEqual([]);
      expect((await fixture.handle.query("SELECT id FROM layers")).rows).toEqual([]);
    } finally {
      await fixture.handle.close();
    }
  },
);

test.each([false, true])(
  "every text click must hit a mask before any revision commits (dryRun=%s)",
  async (dryRun) => {
    const mask = new Float32Array(48).fill(0.49);
    mask[1 * 8 + 1] = 1;
    const fixture = await groundedMaskFixture("missed-click", [mask]);
    try {
      const response = await fixture.select([
        "--at",
        "1,1",
        "--at",
        "6,3",
        ...(dryRun ? ["--dry-run"] : []),
      ]);
      expect(response).toMatchObject({
        ok: false,
        code: "usage",
        data: { reason: "no_match", point: [6, 3] },
      });
      expect((await fixture.handle.query("SELECT id FROM document_revisions")).rows).toEqual([]);
      expect((await fixture.handle.query("SELECT id FROM layers")).rows).toEqual([]);
    } finally {
      await fixture.handle.close();
    }
  },
);

test("repeated text clicks choose each hit instance once in grounding order", async () => {
  const masks = [new Float32Array(48), new Float32Array(48), new Float32Array(48)];
  masks[0]![1 * 8 + 1] = 1;
  masks[1]![2 * 8 + 4] = 1;
  masks[2]![3 * 8 + 6] = 1;
  const fixture = await groundedMaskFixture("repeated-clicks", masks);
  try {
    const response = await fixture.select(["--at", "6,3", "--at", "1,1", "--at", "6,3"]);
    expect(response).toMatchObject({ ok: true });
    if (!response.ok) throw new Error("segment failed");
    expect(
      segmentInstancesDataSchema
        .parse(response.data)
        .instances.map(({ i, label }) => ({ i, label })),
    ).toEqual([
      { i: 0, label: "subject 1" },
      { i: 1, label: "subject 3" },
    ]);
    expect(
      (await fixture.handle.query("SELECT name, z FROM document_revision_layers ORDER BY z")).rows,
    ).toEqual([
      { name: "subject 1", z: 0 },
      { name: "subject 3", z: 1 },
    ]);
  } finally {
    await fixture.handle.close();
  }
});

test("a text click with no grounded instances reports no match", async () => {
  const fixture = await groundedMaskFixture("empty-click", []);
  try {
    expect(await fixture.select(["--at", "1,1"])).toMatchObject({
      ok: false,
      code: "usage",
      data: { reason: "no_match", point: [1, 1] },
    });
    expect((await fixture.handle.query("SELECT id FROM document_revisions")).rows).toEqual([]);
  } finally {
    await fixture.handle.close();
  }
});

test("text grounding creates one base-coordinate mask layer per returned instance", async () => {
  const fixture = await fixtureLibrary("text");
  try {
    const structured = cannedGrounding([
      { box_2d: [1, 1, 2, 2], label: "left person" },
      { box_2d: [4, 2, 3, 2], label: "right person" },
    ]);
    const segmenter = fixtureSegmenter([
      [1, 1, 2, 2],
      [4, 2, 3, 2],
    ]);
    const response = await dispatch(
      {
        verb: "segment",
        args: [fixture.id, "--text", "people"],
        cwd: fixture.parent,
        env: { noDaemon: true },
      },
      {
        version: "test",
        library: fixture.handle,
        segmentation: {
          local: segmenter,
          structured,
          image: {
            bytes: Buffer.from("jpeg"),
            mediaType: "image/jpeg",
            dimensions: { w: 8, h: 6 },
          },
        },
      },
    );

    expect(response).toMatchObject({
      ok: true,
      data: {
        id: fixture.id,
        gateway_calls: 1,
        instances: [
          { i: 0, label: "left person", bbox: [1, 1, 2, 2], layer_id: expect.any(String) },
          { i: 1, label: "right person", bbox: [4, 2, 3, 2], layer_id: expect.any(String) },
        ],
      },
    });
    if (!response.ok) throw new Error("segment failed");
    segmentInstancesDataSchema.parse(response.data);
    expect(segmenter.prompts).toEqual([
      { points: groundingPoints, space: "render" },
      { points: groundingPoints, space: "render" },
    ]);
    const rows = await fixture.handle.query<{ name: string; z: number }>(
      "SELECT name, z FROM document_revision_layers ORDER BY z",
    );
    expect(rows.rows).toEqual([
      { name: "left person", z: 0 },
      { name: "right person", z: 1 },
    ]);
  } finally {
    await fixture.handle.close();
  }
});

test("text dry-run returns grounded masks without creating graph or layer rows", async () => {
  const fixture = await fixtureLibrary("dry-run");
  try {
    const response = await dispatch(
      {
        verb: "segment",
        args: [fixture.id, "--text", "person", "--dry-run"],
        cwd: fixture.parent,
        env: { noDaemon: true },
      },
      {
        version: "test",
        library: fixture.handle,
        segmentation: {
          local: fixtureSegmenter([[2, 1, 3, 4]]),
          structured: cannedGrounding([{ box_2d: [2, 1, 3, 4], label: "person" }]),
          image: {
            bytes: Buffer.from("jpeg"),
            mediaType: "image/jpeg",
            dimensions: { w: 8, h: 6 },
          },
        },
      },
    );
    expect(response).toMatchObject({
      ok: true,
      data: {
        instances: [{ bbox: [2, 1, 3, 4], layer_id: null, mask: { bbox: [2, 1, 3, 4] } }],
      },
    });
    const counts = await Promise.all(
      ["layers", "document_revisions", "image_nodes", "image_artifacts"].map(
        async (table) =>
          await fixture.handle.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM ${table}`,
          ),
      ),
    );
    expect(counts.map(({ rows }) => rows[0]!.count)).toEqual(["0", "0", "0", "0"]);
  } finally {
    await fixture.handle.close();
  }
});

test("point segmentation preserves every point and an optional box in base coordinates", async () => {
  const fixture = await fixtureLibrary("points");
  try {
    const prompts: Array<
      Pick<Parameters<SegmentationAdapter["segment"]>[0], "points" | "box" | "space">
    > = [];
    const local: SegmentationAdapter = {
      segment: async ({ dimensions, points, box, space }) => {
        prompts.push({ points, space, ...(box ? { box } : {}) });
        return rasterizeManualMask(dimensions, { kind: "box", bbox: [1, 1, 4, 3] }).mask;
      },
    };
    const response = await dispatch(
      {
        verb: "segment",
        args: [
          fixture.id,
          "--at",
          "0.25,0.5",
          "--at",
          "0.5,0.5",
          "--box",
          "0.125,0.1666666667,0.5,0.5",
          "--norm",
          "--dry-run",
        ],
        cwd: fixture.parent,
        env: { noDaemon: true },
      },
      { version: "test", library: fixture.handle, segmentation: { local } },
    );
    expect(response).toMatchObject({
      ok: true,
      data: { gateway_calls: 0, instances: [{ bbox: [1, 1, 4, 3], layer_id: null }] },
    });
    expect(prompts).toEqual([
      {
        points: [
          { at: [2, 3], label: 1 },
          { at: [4, 3], label: 1 },
        ],
        space: "base",
        box: [1, expect.closeTo(1), 4, 3],
      },
    ]);
  } finally {
    await fixture.handle.close();
  }
});

test("text with no grounded matches succeeds without creating a revision", async () => {
  const fixture = await fixtureLibrary("empty");
  try {
    const response = await dispatch(
      {
        verb: "segment",
        args: [fixture.id, "--text", "missing subject"],
        cwd: fixture.parent,
        env: { noDaemon: true },
      },
      {
        version: "test",
        library: fixture.handle,
        segmentation: {
          local: fixtureSegmenter(),
          structured: cannedGrounding([]),
          image: {
            bytes: Buffer.from("jpeg"),
            mediaType: "image/jpeg",
            dimensions: { w: 8, h: 6 },
          },
        },
      },
    );
    expect(response).toMatchObject({
      ok: true,
      data: { instances: [], revision_id: null, render_hash: null, gateway_calls: 1 },
    });
    const revisions = await fixture.handle.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM document_revisions",
    );
    expect(revisions.rows[0]!.count).toBe("0");
  } finally {
    await fixture.handle.close();
  }
});

test("a non-positive segmentation box is rejected before local segmentation", async () => {
  const fixture = await fixtureLibrary("invalid-box");
  try {
    const response = await dispatch(
      {
        verb: "segment",
        args: [fixture.id, "--at", "2,2", "--box", "1,1,0,2"],
        cwd: fixture.parent,
        env: { noDaemon: true },
      },
      {
        version: "test",
        library: fixture.handle,
        segmentation: {
          local: {
            segment: async () =>
              rasterizeManualMask({ w: 8, h: 6 }, { kind: "box", bbox: [0, 0, 1, 1] }).mask,
          },
        },
      },
    );
    expect(response).toMatchObject({ ok: false, code: "usage" });
  } finally {
    await fixture.handle.close();
  }
});

function cannedGrounding(
  instances: Array<Omit<GroundedInstance, "points"> & Partial<Pick<GroundedInstance, "points">>>,
): StructuredModelAdapter {
  return {
    id: "fake-grounding",
    version: "1",
    ask: async <Value>(schema: { parse(value: unknown): Value }) => ({
      value: schema.parse({
        instances: instances.map((instance) => ({
          ...instance,
          points: instance.points ?? groundingPoints,
        })),
      }),
      model: "fake/grounding-v1",
      requestId: "fixture-request",
      attempts: 1,
    }),
  };
}

async function groundedMaskFixture(suffix: string, masks: Float32Array[]) {
  const fixture = await fixtureLibrary(suffix);
  const structured = cannedGrounding(
    masks.map((_, index) => ({
      label: `subject ${index + 1}`,
      box_2d: [0, 0, 8, 6],
      points: groundingPoints.map((point, pointIndex) =>
        pointIndex === 0 ? { label: point.label, at: [index + 1, 1] } : point,
      ),
    })),
  );
  return {
    ...fixture,
    select: (args: string[]) =>
      dispatch(
        {
          verb: "segment",
          args: [fixture.id, "--text", "matching subjects", ...args],
          cwd: fixture.parent,
          env: { noDaemon: true },
        },
        {
          version: "test",
          library: fixture.handle,
          segmentation: {
            structured,
            image: {
              bytes: Buffer.from("jpeg"),
              mediaType: "image/jpeg",
              dimensions: { w: 8, h: 6 },
            },
            local: {
              segment: async ({ dimensions, points }) => {
                const data = masks[points[0]!.at[0] - 1];
                if (!data) throw new Error("Missing fixture guidance");
                return { ...dimensions, data };
              },
            },
          },
        },
      ),
  };
}

function fixtureSegmenter(
  boxes: Array<[number, number, number, number]> = [],
): SegmentationAdapter & {
  prompts: Array<Pick<Parameters<SegmentationAdapter["segment"]>[0], "points" | "box" | "space">>;
} {
  const prompts: Array<
    Pick<Parameters<SegmentationAdapter["segment"]>[0], "points" | "box" | "space">
  > = [];
  return {
    prompts,
    segment: async ({ dimensions, points, box, space }) => {
      const bounds = boxes[prompts.length];
      prompts.push({ points, space, ...(box ? { box } : {}) });
      if (!bounds) throw new Error("No fixture mask for this prompt");
      return rasterizeManualMask(dimensions, { kind: "box", bbox: bounds }).mask;
    },
  };
}

async function fixtureLibrary(suffix: string) {
  const parent = await mkdtemp(join(tmpdir(), `photoctl-segment-${suffix}-`));
  directories.push(parent);
  const initialized = await initializeLibrary(join(parent, "library"));
  const id =
    suffix === "text"
      ? "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c151"
      : suffix === "dry-run"
        ? "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c152"
        : suffix === "points"
          ? "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c153"
          : suffix === "empty"
            ? "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c154"
            : "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c155";
  await initialized.handle.query(
    `WITH seed (id, content_key, size, w, h, orientation) AS (VALUES ($1, $2, 1, 8, 6, 1)), inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation) SELECT id::uuid, id::uuid, w::integer, h::integer, orientation::integer FROM seed RETURNING id) INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation) SELECT id::uuid, id::uuid, 'image', content_key, size::bigint, w::integer, h::integer, orientation::integer FROM seed`,
    [id, `ck_${suffix.padEnd(16, "0")}`],
  );
  return { parent, handle: initialized.handle, id };
}
