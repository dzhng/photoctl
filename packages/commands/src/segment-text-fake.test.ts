import { initializeLibrary } from "@photoctl/library";
import { segmentInstancesDataSchema } from "@photoctl/protocol";
import { rasterizeManualMask, Sam2Segmenter, type MaskImage } from "@photoctl/render";
import { cacheRootForLibrary, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import sharp from "sharp";
import type { StructuredModelAdapter } from "@photoctl/providers";
import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createServer } from "node:http";
import { dispatch, type SegmentationAdapter } from "./dispatch.js";

const directories: string[] = [];

test("production text grounding uses the cropped render box and commits masks in base coordinates", async () => {
  const fixture = await fixtureLibrary("grounded-production");
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                instances: [{ label: "person", box_2d: [0, 0, 1000, 1000] }],
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
      segmenter: new Sam2Segmenter(async () => ({
        encoderInputNames: () => [],
        decoderInputNames: () => [],
        runEncoder: async () =>
          [
            [1, 32, 256, 256],
            [1, 64, 128, 128],
            [1, 256, 64, 64],
          ].map((dimensions) => ({
            dimensions,
            data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
          })),
        runDecoder: async (inputs) => {
          expect([...inputs.find((input) => input.name === "point_labels")!.i32Data!]).toEqual([
            2, 3,
          ]);
          expect([...inputs.find((input) => input.name === "point_coords")!.f32Data!]).toEqual([
            128, 0, 896, 1024,
          ]);
          return [{ dimensions: [1, 1, 256, 256], data: new Float32Array(256 * 256).fill(1) }];
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
        { verb: "segment", args: [fixture.id, "--text", "person"], cwd: fixture.parent, env },
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
    const segmenter = new Sam2Segmenter(async () => ({
      encoderInputNames: () => [],
      decoderInputNames: () => [],
      runEncoder: async () => {
        encodes++;
        return [
          [1, 32, 256, 256],
          [1, 64, 128, 128],
          [1, 256, 64, 64],
        ].map((dimensions) => ({
          dimensions,
          data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
        }));
      },
      runDecoder: async () => [
        { dimensions: [1, 1, 256, 256], data: new Float32Array(256 * 256).fill(1) },
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

test("production SAM reports missing model files before touching the document", async () => {
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

test("SAM uses the catalog's already-oriented portrait dimensions", async () => {
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

test("text grounding creates one base-coordinate mask layer per returned instance", async () => {
  const fixture = await fixtureLibrary("text");
  try {
    const structured = cannedGrounding([
      { box_2d: [1, 1, 2, 2], label: "left person" },
      { box_2d: [4, 2, 3, 2], label: "right person" },
    ]);
    const segmenter = boxSegmenter();
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
      { points: [], box: [1, 1, 2, 2] },
      { points: [], box: [4, 2, 3, 2] },
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
          local: boxSegmenter(),
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
    const prompts: Array<{
      points: Array<[number, number]>;
      box?: [number, number, number, number];
    }> = [];
    const local: SegmentationAdapter = {
      segment: async ({ dimensions, points, box }) => {
        prompts.push({ points, ...(box ? { box } : {}) });
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
          [2, 3],
          [4, 3],
        ],
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
          local: boxSegmenter(),
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

test("a non-positive SAM box is rejected before local segmentation", async () => {
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
  instances: Array<{ box_2d: [number, number, number, number]; label: string }>,
): StructuredModelAdapter {
  return {
    id: "fake-grounding",
    version: "1",
    ask: async <Value>(schema: { parse(value: unknown): Value }) => ({
      value: schema.parse({ instances }),
      model: "fake/grounding-v1",
      requestId: "fixture-request",
      attempts: 1,
    }),
  };
}

function boxSegmenter(): SegmentationAdapter & {
  prompts: Array<{ points: Array<[number, number]>; box?: [number, number, number, number] }>;
} {
  const prompts: Array<{
    points: Array<[number, number]>;
    box?: [number, number, number, number];
  }> = [];
  return {
    prompts,
    segment: async ({ dimensions, points, box }) => {
      prompts.push({ points, ...(box ? { box } : {}) });
      if (!box) throw new Error("fixture expects a box prompt");
      return rasterizeManualMask(dimensions, { kind: "box", bbox: box }).mask as MaskImage;
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
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, $2, 1, 8, 6, 1)`,
    [id, `ck_${suffix.padEnd(16, "0")}`],
  );
  return { parent, handle: initialized.handle, id };
}
