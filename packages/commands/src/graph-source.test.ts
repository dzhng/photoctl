import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { dispatch } from "./dispatch.js";

test("online RAW graph renders use the native whole-file decoder with full provenance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-graph-raw-source-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const fixture = resolve("fixtures/a7c2.ARW");
  const output = join(directory, "linear.tif");
  const initialized = await initializeLibrary(libraryPath);
  try {
    const env = {
      noDaemon: true,
      libraryPath,
      cacheRoot,
      volumeMap: `${process.cwd()}=fixture-volume:online`,
    };
    const imported = await dispatch(
      { verb: "import", args: [fixture, "--link"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    if (!imported.ok || !("data" in imported)) throw new Error("import failed");
    const id = (imported.data as { ids: string[] }).ids[0];

    const rendered = await dispatch(
      { verb: "render", args: [id, "--linear", "--to", output], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    expect(rendered).toMatchObject({
      ok: true,
      data: { w: 7008, h: 4672 },
      warnings: [],
    });
    const executions = await initialized.handle.query<{
      source_tier: string;
      decoder_id: string;
      decoder_version: string;
    }>(
      `SELECT source_tier, decoder_id, decoder_version
       FROM node_executions WHERE photo_id = $1 AND source_tier IS NOT NULL`,
      [id],
    );
    expect(executions.rows).toContainEqual({
      source_tier: "online-file",
      decoder_id: "libraw",
      decoder_version: "0.22.2-Release",
    });
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
}, 90_000);
