import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { rawTestHelper } from "@photoctl/test-harness";
import { graphNodeDataSchema, graphShowDataSchema, showDataSchema } from "@photoctl/protocol";
import { artifactPath, readArtifactLinear } from "@photoctl/render";
import { dispatch } from "./dispatch.js";

test("RAW overview, detailed preview and reconnection share the required CIRAW treatment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-source-treatment-"));
  const { handle } = await initializeLibrary(join(directory, "library"));
  const env = {
    noDaemon: true,
    macHelperPath: await rawTestHelper(directory, "applied"),
    libraryPath: handle.path,
    cacheRoot: join(directory, "cache"),
    volumeMap: `${process.cwd()}=camera:online`,
  };
  const run = async (verb: string, args: string[]) => {
    const response = await dispatch(
      { verb, args, cwd: directory, env },
      { version: "test", library: handle },
    );
    expect(response.ok).toBe(true);
    if (!response.ok || !("data" in response)) throw new Error(JSON.stringify(response));
    return response.data;
  };
  try {
    const imported = (await run("import", [resolve("fixtures/camera/DSC00107.ARW"), "--link"])) as {
      ids: string[];
    };
    const id = imported.ids[0];
    const overview = showDataSchema.parse(await run("show", [id]));
    expect(overview.preview_info.source_treatment).toMatchObject({
      decoderId: "ciraw",
      status: "applied",
    });
    const shown = showDataSchema.parse(await run("show", [id, "--preview-size", "300"]));
    const graph = graphShowDataSchema.parse(await run("graph", ["show", id]));
    const source = graph.nodes.find((node) => node.kind === "source")!;
    const inspected = graphNodeDataSchema.parse(await run("graph", ["node", id, source.id]));
    const execution = inspected.executions[0];
    expect(execution.source_treatment).toMatchObject({
      requested: "reconstruct",
      status: "applied",
      method: expect.any(String),
      scale: 1,
    });
    expect(shown.preview_info.source_treatment).toEqual(execution.source_treatment);
    const image = await readArtifactLinear(
      artifactPath(handle.path, execution.output_artifact_hash, "tif"),
    );
    expect([image.w, image.h]).toEqual([2, 1]);
    expect(Array.from(image.data)).toEqual(
      Array.from(new Float32Array([0.1, 0.2, 0.3, 2, 1, 0.5])),
    );
    expect(overview.preview_info.source_treatment).toEqual(execution.source_treatment);
    expect(shown.render_hash).toBe(graph.render_hash);
    env.volumeMap = `${process.cwd()}=camera:offline`;
    const offline = await dispatch(
      { verb: "show", args: [id, "--preview-size", "300"], cwd: directory, env },
      { version: "test", library: handle },
    );
    expect(offline).toMatchObject({ ok: false, code: "file_offline" });
    const offlineDecode = await dispatch(
      { verb: "decode", args: [id, "--to", join(directory, "offline.tif")], cwd: directory, env },
      { version: "test", library: handle },
    );
    expect(offlineDecode).toMatchObject({ ok: false, code: "file_offline" });
    env.volumeMap = `${process.cwd()}=camera:online`;
    const reconnected = showDataSchema.parse(await run("show", [id, "--preview-size", "300"]));
    expect(reconnected.preview_info.source_treatment).toEqual(execution.source_treatment);
    expect(reconnected.render_hash).toBe(shown.render_hash);
  } finally {
    await handle.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
