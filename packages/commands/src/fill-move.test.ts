/* eslint-disable no-await-in-loop -- Command order is the behavior under test. */
import { initializeLibrary } from "@photoctl/library";
import { fillMoveDataSchema, showDataSchema } from "@photoctl/protocol";
import {
  commitRevision,
  compositeV2Projection,
  evaluateGraphNode,
  loadActiveDocument,
  readArtifactLinear,
} from "@photoctl/render";
import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { dispatch } from "./dispatch.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("fill --move moves subject pixels and mask atomically while retaining one original vacancy", async () => {
  const fixture = await movingSubjectFixture();
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "0,0,10,30"]),
    ) as { layer_id: string };
    const first = fillMoveDataSchema.parse(
      success(
        await command(fixture, "fill", [fixture.id, "--move", segmented.layer_id, "--to", "25,15"]),
      ),
    );
    expect(first).toMatchObject({
      id: fixture.id,
      layer_id: segmented.layer_id,
      vacancy_layer_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      matrix: [1, 0, 0, 1, 20, 0],
    });
    expect(first).not.toHaveProperty("preview");
    expect(await executionCount(fixture)).toBe(0);

    const firstLayers = success(await command(fixture, "layer", ["list", fixture.id])) as {
      layers: Array<{
        id: string;
        role: string;
        of_layer: string | null;
        z: number;
        content_node_id: string;
        mask_node_id: string;
      }>;
    };
    expect(firstLayers.layers).toMatchObject([
      {
        id: first.vacancy_layer_id,
        role: "vacancy",
        of_layer: segmented.layer_id,
        z: 0,
      },
      { id: segmented.layer_id, role: "subject", of_layer: null, z: 1 },
    ]);

    const repeated = success(
      await command(fixture, "fill", [fixture.id, "--move", segmented.layer_id, "--by", "-10,0"]),
    ) as { vacancy_layer_id: string; matrix: number[]; revision_id: string };
    expect(repeated.vacancy_layer_id).toBe(first.vacancy_layer_id);
    expect(repeated.matrix).toEqual([1, 0, 0, 1, 10, 0]);
    expect(repeated.revision_id).not.toBe(first.revision_id);
    const repeatedLayers = success(await command(fixture, "layer", ["list", fixture.id])) as {
      layers: Array<{ id: string; z: number; mask_node_id: string; content_node_id: string }>;
    };
    expect(repeatedLayers.layers.map(({ id }) => id)).toEqual([
      first.vacancy_layer_id,
      segmented.layer_id,
    ]);
    expect(repeatedLayers.layers.map(({ z }) => z)).toEqual([0, 1]);
    expect(repeatedLayers.layers[0]!.mask_node_id).toBe(firstLayers.layers[0]!.mask_node_id);
    expect(repeatedLayers.layers[0]!.content_node_id).toBe(firstLayers.layers[0]!.content_node_id);
    expect(await executionCount(fixture)).toBe(0);
    const subjectGraph = success(
      await command(fixture, "layer", ["show", fixture.id, segmented.layer_id]),
    ) as {
      chain: {
        content: Array<{ kind: string; parameters: unknown }>;
        mask: Array<{ kind: string; parameters: unknown }>;
      };
    };
    const contentTransform = subjectGraph.chain.content.find(({ kind }) => kind === "transform");
    const maskTransform = subjectGraph.chain.mask.find(({ kind }) => kind === "transform");
    expect(contentTransform?.parameters).toEqual({ matrix: repeated.matrix });
    expect(maskTransform?.parameters).toEqual(contentTransform?.parameters);
    const vacancyGraph = success(
      await command(fixture, "layer", ["show", fixture.id, first.vacancy_layer_id]),
    ) as { chain: { mask: Array<{ kind: string }> } };
    expect(vacancyGraph.chain.mask.map(({ kind }) => kind)).toEqual(["mask"]);

    const solid = await evaluateGraphNode({
      database: fixture.handle,
      libraryPath: fixture.handle.path,
      photoId: fixture.id,
      nodeId: repeatedLayers.layers[0]!.content_node_id,
    });
    const solidImage = await readArtifactLinear(solid.artifact.path, solid.artifact.artifactHash);
    expect(solidImage.data.slice(0, 6)).toEqual(new Float32Array([1, 0, 1, 1, 0, 1]));

    const shownEnvelope = await command(fixture, "show", [fixture.id, "--preview-size", "native"]);
    expect(shownEnvelope).toMatchObject({
      ok: true,
      warnings: [{ code: "vacancy_unfilled", id: fixture.id }],
    });
    if (!shownEnvelope.ok) return;
    const shown = showDataSchema.parse(shownEnvelope.data);
    expect(shown.layers).toEqual({ count: 2, stale: 0 });
    const rendered = await sharp(shown.preview).raw().toBuffer({ resolveWithObject: true });
    const vacancy = sample(rendered, 5, 15);
    const subject = sample(rendered, 15, 15);
    expect(vacancy[0]).toBeGreaterThan(220);
    expect(vacancy[1]).toBeLessThan(40);
    expect(vacancy[2]).toBeGreaterThan(220);
    expect(subject[0]).toBeGreaterThan(subject[2] + 100);

    const historical = await fixture.handle.query<{ z: number }>(
      `SELECT z FROM document_revision_layers
       WHERE photo_id = $1 AND revision_id = $2 ORDER BY z`,
      [fixture.id, first.revision_id],
    );
    expect(historical.rows.map(({ z }) => z)).toEqual([0, 1]);
  } finally {
    await fixture.handle.close();
  }
});

test("vacancy warnings follow the snapped active revision even when export skips evaluation", async () => {
  const fixture = await movingSubjectFixture();
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "0,0,10,30"]),
    ) as { layer_id: string };
    const moved = success(
      await command(fixture, "fill", [fixture.id, "--move", segmented.layer_id, "--by", "10,0"]),
    ) as { vacancy_layer_id: string };
    expect(await command(fixture, "develop", [fixture.id, "--set", "shadows=40"])).toMatchObject({
      ok: true,
    });
    const delivery = join(fixture.parent, "delivery");
    await mkdir(delivery);
    await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } })
      .jpeg()
      .toFile(join(delivery, "source.jpg"));

    const exported = await command(fixture, "export", [
      fixture.id,
      "--to",
      delivery,
      "--on-collision",
      "skip",
    ]);
    expect(exported).toMatchObject({
      ok: true,
      results: [{ id: fixture.id, skipped: true }],
      warnings: [
        { code: "layers_stale", id: fixture.id },
        { code: "vacancy_unfilled", id: fixture.id },
      ],
    });
    expect(await executionCount(fixture)).toBe(0);

    const active = await loadActiveDocument(fixture.handle, fixture.id);
    if (!active) throw new Error("Expected active document");
    const disabled = active.layers.map((layer) => ({
      layer: { layerId: layer.id },
      name: layer.name,
      z: layer.z,
      contentNode: { nodeId: layer.contentNodeId },
      maskNode: { nodeId: layer.maskNodeId },
      opacity: layer.opacity,
      blend: layer.blend,
      enabled: layer.id === moved.vacancy_layer_id ? false : layer.enabled,
    }));
    const projection = compositeV2Projection({ nodeId: active.roots.base }, disabled);
    await commitRevision(fixture.handle, {
      photoId: fixture.id,
      expectedRevisionId: active.revisionId,
      nodes: [{ localKey: "composite", kind: "composite", recipeVersion: 2, ...projection }],
      rootUpdates: [{ root: "output", node: { localKey: "composite" } }],
      layers: disabled,
    });
    const disabledVacancy = await command(fixture, "export", [
      fixture.id,
      "--to",
      delivery,
      "--on-collision",
      "skip",
    ]);
    expect(disabledVacancy).toMatchObject({
      ok: true,
      warnings: [{ code: "layers_stale", id: fixture.id }],
    });

    success(await command(fixture, "layer", ["remove", fixture.id, moved.vacancy_layer_id]));
    const historicalVacancy = await command(fixture, "export", [
      fixture.id,
      "--to",
      delivery,
      "--on-collision",
      "skip",
    ]);
    expect(historicalVacancy).toMatchObject({
      ok: true,
      warnings: [{ code: "layers_stale", id: fixture.id }],
    });
    const restored = fillMoveDataSchema.parse(
      success(
        await command(fixture, "fill", [fixture.id, "--move", segmented.layer_id, "--by", "1,0"]),
      ),
    );
    expect(restored.vacancy_layer_id).toBe(moved.vacancy_layer_id);
    expect(await executionCount(fixture)).toBe(0);
  } finally {
    await fixture.handle.close();
  }
});

test("develop reports and counts only photographic layers while vacancy pixels remain exact", async () => {
  const fixture = await movingSubjectFixture();
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "0,0,10,30"]),
    ) as { layer_id: string };
    const moved = success(
      await command(fixture, "fill", [fixture.id, "--move", segmented.layer_id, "--by", "10,0"]),
    ) as { vacancy_layer_id: string };

    const compensated = await command(fixture, "develop", [fixture.id, "--set", "exposure=0.5"]);
    expect(compensated).toMatchObject({
      ok: true,
      results: [{ layers: { delta_applied: [segmented.layer_id], stale: [] } }],
    });
    const subjectAfterDelta = success(
      await command(fixture, "layer", ["show", fixture.id, segmented.layer_id]),
    ) as { chain: { content: Array<{ kind: string }> } };
    expect(subjectAfterDelta.chain.content.map(({ kind }) => kind)).toEqual([
      "delta",
      "transform",
      "output",
      "source",
    ]);
    const vacancyAfterDelta = success(
      await command(fixture, "layer", ["show", fixture.id, moved.vacancy_layer_id]),
    ) as { chain: { content: Array<{ kind: string }> } };
    expect(vacancyAfterDelta.chain.content.map(({ kind }) => kind)).toEqual(["solid"]);

    const stale = await command(fixture, "develop", [fixture.id, "--set", "shadows=40"]);
    expect(stale).toMatchObject({
      ok: true,
      results: [{ layers: { delta_applied: [], stale: [segmented.layer_id] } }],
    });
    const shown = await command(fixture, "show", [fixture.id]);
    expect(shown, JSON.stringify(shown)).toMatchObject({
      ok: true,
      data: { layers: { count: 2, stale: 1 } },
      warnings: [
        { code: "layers_stale", id: fixture.id },
        { code: "vacancy_unfilled", id: fixture.id },
      ],
    });
  } finally {
    await fixture.handle.close();
  }
});

test("fill --move validates its exclusive coordinate modes and subject role", async () => {
  const fixture = await movingSubjectFixture();
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "0,0,10,30"]),
    ) as { layer_id: string };
    for (const args of [
      [fixture.id, "--move", segmented.layer_id],
      [fixture.id, "--move", segmented.layer_id, "--to", "1,2", "--by", "3,4"],
      [fixture.id, "--move", segmented.layer_id, "--by", "2"],
      [fixture.id, "--move", segmented.layer_id, "--to", "2,0", "--norm"],
    ]) {
      expect(await command(fixture, "fill", args)).toMatchObject({ ok: false, code: "usage" });
    }
    const moved = success(
      await command(fixture, "fill", [
        fixture.id,
        "--move",
        segmented.layer_id,
        "--by",
        "0.25,0",
        "--norm",
      ]),
    ) as { vacancy_layer_id: string; matrix: number[] };
    expect(moved.matrix).toEqual([1, 0, 0, 1, 10, 0]);
    expect(
      await command(fixture, "layer", ["duplicate", fixture.id, moved.vacancy_layer_id]),
    ).toMatchObject({ ok: false, code: "usage" });
    expect(
      await command(fixture, "fill", [fixture.id, "--move", moved.vacancy_layer_id, "--by", "1,0"]),
    ).toMatchObject({ ok: false, code: "usage" });
  } finally {
    await fixture.handle.close();
  }
});

async function movingSubjectFixture() {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-fill-move-"));
  directories.push(parent);
  const source = join(parent, "source.png");
  const pixels = Buffer.alloc(40 * 30 * 3);
  for (let pixel = 0; pixel < 40 * 30; pixel += 1) {
    const x = pixel % 40;
    pixels[pixel * 3] = x < 10 ? 240 : 10;
    pixels[pixel * 3 + 1] = 20;
    pixels[pixel * 3 + 2] = x < 10 ? 10 : 240;
  }
  await sharp(pixels, { raw: { width: 40, height: 30, channels: 3 } })
    .png()
    .toFile(source);
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  const fixture = {
    parent,
    source,
    handle,
    env: {
      noDaemon: true,
      cacheRoot: join(parent, "cache"),
      volumeMap: `${parent}=fixture-volume:online`,
    },
    id: "",
  };
  const imported = success(await command(fixture, "import", [source, "--link"])) as {
    ids: string[];
  };
  fixture.id = imported.ids[0]!;
  return fixture;
}

async function command(
  fixture: {
    parent: string;
    handle: Awaited<ReturnType<typeof initializeLibrary>>["handle"];
    env: { noDaemon: boolean; cacheRoot: string; volumeMap: string };
  },
  verb: string,
  args: string[],
) {
  return await dispatch(
    { verb, args, cwd: fixture.parent, env: fixture.env },
    { version: "test", library: fixture.handle },
  );
}

function success(envelope: Awaited<ReturnType<typeof command>>): unknown {
  expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
  if (!envelope.ok || !("data" in envelope)) throw new Error("Expected data envelope");
  return envelope.data;
}

async function executionCount(fixture: {
  handle: Awaited<ReturnType<typeof initializeLibrary>>["handle"];
}) {
  return Number(
    (
      await fixture.handle.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM node_executions",
      )
    ).rows[0]!.count,
  );
}

function sample(
  image: { data: Buffer; info: { width: number; channels: number } },
  x: number,
  y: number,
) {
  const offset = (y * image.info.width + x) * image.info.channels;
  return [image.data[offset]!, image.data[offset + 1]!, image.data[offset + 2]!];
}
