import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { commitRevision } from "@photoctl/render";
import { dispatch } from "./dispatch.js";

function imageMean(stats: Awaited<ReturnType<typeof sharp.prototype.stats>>): number {
  return stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
}

test("a preview and following export identify the same snapped render state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-hash-"));
  const source = join(directory, "photo.jpg");
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const initialized = await initializeLibrary(libraryPath);
  try {
    await sharp({ create: { width: 120, height: 80, channels: 3, background: "#864" } })
      .jpeg()
      .toFile(source);
    const env = {
      noDaemon: true,
      libraryPath,
      cacheRoot,
      volumeMap: `${directory}=fixture-volume:online`,
    };
    const imported = await dispatch(
      { verb: "import", args: [source, "--link"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    if (!imported.ok || !("data" in imported)) throw new Error("fixture import failed");
    const id = (imported.data as { ids: string[] }).ids[0];
    const shown = await dispatch(
      { verb: "show", args: [id], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    const exported = await dispatch(
      { verb: "export", args: [id, "--to", join(directory, "out")], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );

    expect(shown).toMatchObject({ schema: 1, ok: true });
    expect(exported).toMatchObject({ schema: 1, ok: true });
    expect((exported as { results: Array<{ render_hash: string }> }).results[0].render_hash).toBe(
      (shown as { data: { render_hash: string } }).data.render_hash,
    );
    const preview = (shown as { data: { preview: string } }).data.preview;
    const output = (exported as { results: Array<{ file: string }> }).results[0].file;
    const [sourceMean, previewMean, outputMean] = await Promise.all(
      [source, preview, output].map(async (path) => imageMean(await sharp(path).stats())),
    );
    expect(previewMean).toBeCloseTo(sourceMean, 0);
    expect(outputMean).toBeCloseTo(sourceMean, 0);
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});

test("export evaluates the snapped output node to a canonical artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-evaluator-"));
  const source = join(directory, "photo.jpg");
  const libraryPath = join(directory, "library");
  const initialized = await initializeLibrary(libraryPath);
  try {
    await sharp({ create: { width: 120, height: 80, channels: 3, background: "#864" } })
      .jpeg()
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
    if (!imported.ok || !("data" in imported)) throw new Error("fixture import failed");
    const id = (imported.data as { ids: string[] }).ids[0];

    const exported = await dispatch(
      { verb: "export", args: [id, "--to", join(directory, "out")], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    const executions = await initialized.handle.query<{
      node_id: string;
      output_artifact_hash: string;
    }>(
      `SELECT execution.node_id, execution.output_artifact_hash
         FROM node_executions AS execution
         JOIN photo_documents AS document ON document.photo_id = execution.photo_id
         JOIN document_revision_roots AS root
           ON (root.photo_id, root.revision_id, root.node_id) =
              (document.photo_id, document.active_revision_id, execution.node_id)
        WHERE execution.photo_id = $1 AND root.root_name = 'output'`,
      [id],
    );

    expect(exported).toMatchObject({
      schema: 1,
      ok: true,
      results: [{ id, ok: true, render_hash: expect.stringMatching(/^r_[0-9a-f]{64}$/u) }],
    });
    expect(executions.rows).toEqual([
      {
        node_id: expect.stringMatching(/^node_[0-9a-f]{64}$/u),
        output_artifact_hash: expect.stringMatching(/^a_[0-9a-f]{64}$/u),
      },
    ]);
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});

test("export consumes the active global develop node", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-edited-root-"));
  const source = join(directory, "photo.jpg");
  const output = join(directory, "out");
  const libraryPath = join(directory, "library");
  const initialized = await initializeLibrary(libraryPath);
  try {
    await sharp({ create: { width: 120, height: 80, channels: 3, background: "#864" } })
      .jpeg()
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
    if (!imported.ok || !("data" in imported)) throw new Error("fixture import failed");
    const id = (imported.data as { ids: string[] }).ids[0];
    const sourceRevision = await commitRevision(initialized.handle, {
      photoId: id,
      expectedRevisionId: null,
      nodes: [
        {
          localKey: "source",
          kind: "source",
          recipeVersion: 1,
          parameters: { orientation: 1 },
          inputs: [],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });
    await commitRevision(initialized.handle, {
      photoId: id,
      expectedRevisionId: sourceRevision.revisionId,
      nodes: [
        {
          localKey: "edited",
          kind: "develop",
          recipeVersion: 1,
          parameters: { exposure: 1 },
          inputs: [{ nodeId: sourceRevision.roots.output! }],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "edited" } }],
    });

    const exported = await dispatch(
      { verb: "export", args: [id, "--to", output], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );

    expect(exported).toMatchObject({
      schema: 1,
      ok: true,
      results: [{ id, ok: true, render_hash: expect.stringMatching(/^r_[0-9a-f]{64}$/u) }],
    });
    const outputPath = join(output, "photo.jpg");
    await expect(access(outputPath)).resolves.toBeUndefined();
    const [sourceStats, outputStats] = await Promise.all([
      sharp(source).stats(),
      sharp(outputPath).stats(),
    ]);
    expect(imageMean(outputStats)).toBeGreaterThan(imageMean(sourceStats) * 1.2);
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});
