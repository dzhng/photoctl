/* eslint-disable no-await-in-loop -- Command order is the behavior under test. */
import { initializeLibrary } from "@photoctl/library";
import { artifactPath, readArtifactMask } from "@photoctl/render";
import {
  importDataSchema,
  layerClearDataSchema,
  layerDuplicateDataSchema,
  layerListDataSchema,
  layerMutationDataSchema,
  layerSetDataSchema,
  layerShowDataSchema,
  layerTransformDataSchema,
  segmentDataSchema,
  showDataSchema,
} from "@photoctl/protocol";
import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { dispatch } from "./dispatch.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("manual box segmentation creates a permanent layer without eagerly evaluating pixels", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-layer-command-"));
  directories.push(parent);
  const initialized = await initializeLibrary(join(parent, "library"));
  const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c041";
  try {
    await initialized.handle.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_4567890abcdef123', 1, 4, 3, 1)`,
      [photoId],
    );

    const segmented = await command(initialized.handle, parent, "segment", [
      photoId,
      "--box",
      "1,1,2,1",
    ]);
    expect(segmented.ok).toBe(true);
    if (!segmented.ok) return;
    const segment = segmentDataSchema.parse(segmented.data);
    expect(segment).toMatchObject({
      id: photoId,
      layer_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      revision_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      render_hash: expect.stringMatching(/^r_[0-9a-f]{64}$/),
      mask: {
        artifact_hash: expect.stringMatching(/^a_[0-9a-f]{64}$/),
        bbox: [1, 1, 2, 1],
        pixels: 2,
      },
    });
    expect(segmented.data).not.toHaveProperty("preview");

    const maskHash = segment.mask.artifact_hash;
    expect(
      (await readArtifactMask(artifactPath(initialized.handle.path, maskHash, "tif"), maskHash))
        .data,
    ).toEqual(new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]));
    expect(
      (
        await initialized.handle.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM node_executions",
        )
      ).rows[0]!.count,
    ).toBe("0");

    const listed = await command(initialized.handle, parent, "layer", ["list", photoId]);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data).toMatchObject({
      id: photoId,
      revision_id: segment.revision_id,
      render_hash: segment.render_hash,
      layers: [
        {
          id: segment.layer_id,
          role: "subject",
          name: "Segment 1",
          z: 0,
          opacity: 1,
          blend: "normal",
          enabled: true,
        },
      ],
    });
  } finally {
    await initialized.handle.close();
  }
});

test("manual layer commands create immutable revisions and retain stable identities", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-layer-mutations-"));
  directories.push(parent);
  const initialized = await initializeLibrary(join(parent, "library"));
  const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c042";
  try {
    await initialized.handle.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_567890abcdef1234', 1, 4, 3, 1)`,
      [photoId],
    );
    const first = segmentDataSchema.parse(
      success(await command(initialized.handle, parent, "segment", [photoId, "--box", "0,0,1,1"])),
    );
    const second = segmentDataSchema.parse(
      success(
        await command(initialized.handle, parent, "segment", [
          photoId,
          "--brush",
          "[[0.5,0],[1,0],[1,1],[0.5,1]]",
          "--norm",
        ]),
      ),
    );
    expect(second.mask).toMatchObject({ bbox: [2, 0, 2, 3], pixels: 6 });

    const shown = layerShowDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", ["show", photoId, first.layer_id]),
      ),
    );
    expect(shown.layer).toMatchObject({ id: first.layer_id, name: "Segment 1", z: 0 });
    expect(shown.chain.content.map((node: { kind: string }) => node.kind)).toEqual([
      "output",
      "source",
    ]);
    expect(shown.chain.mask.map((node: { kind: string }) => node.kind)).toEqual(["mask"]);

    const absolute = layerTransformDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", [
          "transform",
          photoId,
          first.layer_id,
          "--dx",
          "1",
          "--rotate",
          "90",
          "--anchor",
          "0.5,0.5",
        ]),
      ),
    );
    expect(absolute.matrix).toEqual([0, 1, -1, 0, 2, 0]);
    const absoluteAgain = layerTransformDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", [
          "transform",
          photoId,
          first.layer_id,
          "--dx",
          "1",
          "--rotate",
          "90",
          "--anchor",
          "0.5,0.5",
        ]),
      ),
    );
    expect(absoluteAgain.render_hash).toBe(absolute.render_hash);
    expect(absoluteAgain.revision_id).not.toBe(absolute.revision_id);
    const relative = layerTransformDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", [
          "transform",
          photoId,
          first.layer_id,
          "--dx",
          "1",
          "--relative",
          "--anchor",
          "0,0",
        ]),
      ),
    );
    expect(relative.matrix).toEqual([0, 1, -1, 0, 3, 0]);
    const aroundMovedCentroid = layerTransformDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", [
          "transform",
          photoId,
          first.layer_id,
          "--rotate",
          "180",
          "--relative",
        ]),
      ),
    );
    expect(aroundMovedCentroid.matrix).toEqual([0, -1, 1, 0, 2, 1]);

    success(
      await command(initialized.handle, parent, "develop", [photoId, "--set", "exposure=0.5"]),
    );
    const normalizedTransform = layerTransformDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", [
          "transform",
          photoId,
          second.layer_id,
          "--dx",
          "0.25",
          "--norm",
        ]),
      ),
    );
    expect(normalizedTransform.matrix).toEqual([1, 0, 0, 1, 1, 0]);
    const firstTransformAfterDevelop = layerShowDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", ["show", photoId, second.layer_id]),
      ),
    );
    expect(firstTransformAfterDevelop.chain.content.map(({ kind }) => kind)).toEqual([
      "delta",
      "transform",
      "output",
      "source",
    ]);
    layerTransformDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", [
          "transform",
          photoId,
          first.layer_id,
          "--dx",
          "2",
          "--anchor",
          "0,0",
        ]),
      ),
    );
    const compensated = layerShowDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", ["show", photoId, first.layer_id]),
      ),
    );
    expect(compensated.chain.content.map(({ kind }) => kind)).toEqual([
      "delta",
      "transform",
      "output",
      "source",
    ]);

    for (const args of [
      ["reorder", photoId, first.layer_id, "--front"],
      ["reorder", photoId, first.layer_id, "--back"],
      ["reorder", photoId, first.layer_id, "--up"],
      ["reorder", photoId, first.layer_id, "--down"],
      ["reorder", photoId, first.layer_id, "--to", "2"],
    ]) {
      layerMutationDataSchema.parse(
        success(await command(initialized.handle, parent, "layer", args)),
      );
    }
    const ordered = layerListDataSchema.parse(
      success(await command(initialized.handle, parent, "layer", ["list", photoId])),
    );
    expect(ordered.layers.map((layer: { id: string }) => layer.id)).toEqual([
      second.layer_id,
      first.layer_id,
    ]);

    const set = layerSetDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", [
          "set",
          photoId,
          first.layer_id,
          "--name",
          "Lead subject",
          "--opacity",
          "0.4",
          "--blend",
          "normal",
        ]),
      ),
    );
    expect(set.layer).toMatchObject({ name: "Lead subject", opacity: 0.4, blend: "normal" });

    const duplicated = layerDuplicateDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", ["duplicate", photoId, first.layer_id]),
      ),
    );
    expect(duplicated.layer_id).not.toBe(first.layer_id);
    expect(duplicated.layer).toMatchObject({ name: "Lead subject copy", opacity: 0.4 });
    layerMutationDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", [
          "remove",
          photoId,
          duplicated.layer_id,
        ]),
      ),
    );

    const beforeClear = layerListDataSchema.parse(
      success(await command(initialized.handle, parent, "layer", ["list", photoId])),
    );
    const cleared = layerClearDataSchema.parse(
      success(await command(initialized.handle, parent, "layer", ["clear", photoId])),
    );
    expect(cleared.removed).toBe(2);
    expect(
      layerListDataSchema.parse(
        success(await command(initialized.handle, parent, "layer", ["list", photoId])),
      ).layers,
    ).toEqual([]);
    const historical = await initialized.handle.query<{ id: string }>(
      `SELECT layer_id::text AS id FROM document_revision_layers
       WHERE photo_id = $1 AND revision_id = $2 ORDER BY z`,
      [photoId, beforeClear.revision_id],
    );
    expect(historical.rows.map(({ id }) => id)).toEqual([second.layer_id, first.layer_id]);
    expect(
      (
        await initialized.handle.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM node_executions",
        )
      ).rows[0]!.count,
    ).toBe("0");
  } finally {
    await initialized.handle.close();
  }
});

test("show lazily evaluates a transformed manual layer through the production graph", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-layer-show-"));
  directories.push(parent);
  const libraryPath = join(parent, "library");
  const cacheRoot = join(parent, "cache");
  const source = join(parent, "source.png");
  const sourcePixels = Buffer.alloc(40 * 30 * 3);
  for (let pixel = 0; pixel < 40 * 30; pixel += 1) {
    const x = pixel % 40;
    sourcePixels[pixel * 3] = x < 10 ? 240 : 10;
    sourcePixels[pixel * 3 + 1] = 20;
    sourcePixels[pixel * 3 + 2] = x < 10 ? 10 : 240;
  }
  await sharp(sourcePixels, { raw: { width: 40, height: 30, channels: 3 } })
    .png()
    .toFile(source);
  const initialized = await initializeLibrary(libraryPath);
  const env = {
    noDaemon: true,
    cacheRoot,
    volumeMap: `${parent}=fixture-volume:online`,
  };
  try {
    const imported = importDataSchema.parse(
      success(
        await dispatch(
          { verb: "import", args: [source, "--link"], cwd: parent, env },
          { version: "test", library: initialized.handle },
        ),
      ),
    );
    const id = imported.ids[0];
    const segmented = segmentDataSchema.parse(
      success(
        await dispatch(
          { verb: "segment", args: [id, "--box", "0,0,10,30"], cwd: parent, env },
          { version: "test", library: initialized.handle },
        ),
      ),
    );
    layerTransformDataSchema.parse(
      success(
        await dispatch(
          {
            verb: "layer",
            args: ["transform", id, segmented.layer_id, "--dx", "20", "--anchor", "0,0"],
            cwd: parent,
            env,
          },
          { version: "test", library: initialized.handle },
        ),
      ),
    );
    expect(
      (
        await initialized.handle.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM node_executions",
        )
      ).rows[0]!.count,
    ).toBe("0");

    const shown = showDataSchema.parse(
      success(
        await dispatch(
          { verb: "show", args: [id, "--preview-size", "native"], cwd: parent, env },
          { version: "test", library: initialized.handle },
        ),
      ),
    );
    expect(shown.preview).toBeTypeOf("string");
    expect(shown.layers.count).toBe(1);
    const rendered = await sharp(shown.preview).raw().toBuffer({ resolveWithObject: true });
    const movedSample = (15 * rendered.info.width + 25) * rendered.info.channels;
    expect(rendered.data[movedSample]).toBeGreaterThan(rendered.data[movedSample + 2] + 100);
    expect(
      Number(
        (
          await initialized.handle.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM node_executions",
          )
        ).rows[0]!.count,
      ),
    ).toBeGreaterThan(0);
  } finally {
    await initialized.handle.close();
  }
});

test("manual layer commands reject ambiguous or invalid command values", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-layer-validation-"));
  directories.push(parent);
  const initialized = await initializeLibrary(join(parent, "library"));
  const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c043";
  try {
    await initialized.handle.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_67890abcdef12345', 1, 4, 3, 1)`,
      [photoId],
    );
    for (const [verb, args] of [
      ["segment", [photoId, "--box", "-0.1,0,0.5,1", "--norm"]],
      ["segment", [photoId, "--box", "0,0,1,1", "--brush", "[[0,0],[1,0],[1,1]]"]],
    ] as const) {
      const result = await command(initialized.handle, parent, verb, [...args]);
      expect(result).toMatchObject({ ok: false, code: "usage" });
    }
    const segmented = segmentDataSchema.parse(
      success(await command(initialized.handle, parent, "segment", [photoId, "--box", "0,0,1,1"])),
    );
    for (const args of [
      ["transform", photoId, segmented.layer_id],
      ["reorder", photoId, segmented.layer_id, "--front", "--back"],
      ["set", photoId, segmented.layer_id, "--blend", "multiply"],
      ["transform", photoId, segmented.layer_id, "--dx", "1.1", "--norm"],
      ["transform", photoId, segmented.layer_id, "--rotate", "1", "--anchor", "-0.1,0", "--norm"],
      ["list", photoId, "extra"],
      ["show", photoId, segmented.layer_id, "extra"],
    ]) {
      const result = await command(initialized.handle, parent, "layer", args);
      expect(result).toMatchObject({ ok: false, code: "usage" });
    }
    const maximumName = "x".repeat(256);
    layerSetDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", [
          "set",
          photoId,
          segmented.layer_id,
          "--name",
          maximumName,
        ]),
      ),
    );
    const duplicated = layerDuplicateDataSchema.parse(
      success(
        await command(initialized.handle, parent, "layer", [
          "duplicate",
          photoId,
          segmented.layer_id,
        ]),
      ),
    );
    expect(duplicated.layer.name).toHaveLength(256);
    expect(duplicated.layer.name.endsWith(" copy")).toBe(true);
  } finally {
    await initialized.handle.close();
  }
});

async function command(
  library: Awaited<ReturnType<typeof initializeLibrary>>["handle"],
  cwd: string,
  verb: string,
  args: string[],
) {
  return await dispatch({ verb, args, cwd, env: { noDaemon: true } }, { version: "test", library });
}

function success(envelope: Awaited<ReturnType<typeof command>>): unknown {
  expect(envelope.ok).toBe(true);
  if (!envelope.ok) throw new Error(JSON.stringify(envelope));
  return envelope.data;
}
