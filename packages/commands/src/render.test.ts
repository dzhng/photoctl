// oxlint-disable no-await-in-loop -- each destructive target is checked and exercised in isolation
import { link, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { artifactPath } from "@photoctl/render";
import { dispatch } from "./dispatch.js";

test("render --linear exposes the active graph and one stop doubles linear mean", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-render-linear-"));
  const libraryPath = join(directory, "library");
  const source = join(directory, "source.png");
  const neutral = join(directory, "neutral.tif");
  const edited = join(directory, "edited.tif");
  const repeated = join(directory, "repeated.tif");
  const highlight = join(directory, "highlight.tif");
  const initialized = await initializeLibrary(libraryPath);
  try {
    await sharp({ create: { width: 16, height: 12, channels: 3, background: "#8090a0" } })
      .png()
      .toFile(source);
    const env = {
      noDaemon: true,
      libraryPath,
      cacheRoot: join(directory, "cache"),
      volumeMap: `${directory}=fixture-volume:online`,
    };
    const imported = await dispatch(
      { verb: "import", args: [source, "--link"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    if (!imported.ok || !("data" in imported)) throw new Error("import failed");
    const id = (imported.data as { ids: string[] }).ids[0];

    const first = await dispatch(
      { verb: "render", args: [id, "--linear", "--to", neutral], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    await dispatch(
      { verb: "develop", args: [id, "--set", "exposure=1"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    const second = await dispatch(
      { verb: "render", args: [id, "--linear", "--to", edited], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    await dispatch(
      { verb: "render", args: [id, "--linear", "--to", repeated], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    await dispatch(
      { verb: "develop", args: [id, "--set", "exposure=3"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    await dispatch(
      { verb: "render", args: [id, "--linear", "--to", highlight], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );

    expect(first).toMatchObject({
      ok: true,
      data: { id, file: neutral, space: "scene-linear-rec2020" },
    });
    expect(second).toMatchObject({
      ok: true,
      data: { id, file: edited, space: "scene-linear-rec2020" },
    });
    const activeArtifact = await initialized.handle.query<{ artifact_hash: string }>(
      `SELECT execution.output_artifact_hash AS artifact_hash
       FROM photo_documents AS document
       JOIN document_revision_roots AS root
         ON (root.photo_id, root.revision_id) = (document.photo_id, document.active_revision_id)
       JOIN node_executions AS execution
         ON (execution.photo_id, execution.node_id) = (root.photo_id, root.node_id)
       WHERE document.photo_id = $1`,
      [id],
    );
    const canonical = artifactPath(libraryPath, activeArtifact.rows[0].artifact_hash, "tif");
    expect(await readFile(highlight)).toEqual(await readFile(canonical));
    const meanRatio = (await linearMean(edited)) / (await linearMean(neutral));
    expect(meanRatio).toBeGreaterThanOrEqual(1.95);
    expect(meanRatio).toBeLessThanOrEqual(2.05);
    expect(await readFile(repeated)).toEqual(await readFile(edited));
    expect((await linearMean(highlight)) / (await linearMean(neutral))).toBeCloseTo(8, 5);
    expect(await linearMax(highlight)).toBeGreaterThan(1);
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});

test("render --linear never replaces an existing destination or source locator", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-render-no-clobber-"));
  const libraryPath = join(directory, "library");
  const source = join(directory, "source.png");
  const sourceAlias = join(directory, "source-alias.png");
  const occupied = join(directory, "occupied.tif");
  const initialized = await initializeLibrary(libraryPath);
  try {
    await sharp({ create: { width: 4, height: 3, channels: 3, background: "#456" } })
      .png()
      .toFile(source);
    await link(source, sourceAlias);
    await writeFile(occupied, "keep me");
    const env = {
      noDaemon: true,
      libraryPath,
      cacheRoot: join(directory, "cache"),
      volumeMap: `${directory}=fixture-volume:online`,
    };
    const imported = await dispatch(
      { verb: "import", args: [source, "--link"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    if (!imported.ok || !("data" in imported)) throw new Error("import failed");
    const id = (imported.data as { ids: string[] }).ids[0];

    for (const destination of [occupied, source, sourceAlias]) {
      const before = await readFile(destination);
      const rendered = await dispatch(
        { verb: "render", args: [id, "--linear", "--to", destination], cwd: directory, env },
        { version: "test", library: initialized.handle },
      );
      expect(rendered).toMatchObject({ ok: false, code: "volume_readonly" });
      expect(await readFile(destination)).toEqual(before);
    }
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});

async function linearMean(path: string): Promise<number> {
  const values = await linearSamples(path);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function linearMax(path: string): Promise<number> {
  return Math.max(...(await linearSamples(path)));
}

async function linearSamples(path: string): Promise<number[]> {
  const data = await readFile(path);
  const ifdOffset = data.readUInt32LE(4);
  const entries = data.readUInt16LE(ifdOffset);
  let stripOffset: number | undefined;
  let byteCount: number | undefined;
  for (let index = 0; index < entries; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    const tag = data.readUInt16LE(entry);
    if (tag === 273) stripOffset = data.readUInt32LE(entry + 8);
    if (tag === 279) byteCount = data.readUInt32LE(entry + 8);
  }
  if (stripOffset === undefined || byteCount === undefined)
    throw new Error("TIFF has no pixel strip");
  return Array.from({ length: byteCount / 4 }, (_, index) =>
    data.readFloatLE(stripOffset + index * 4),
  );
}
