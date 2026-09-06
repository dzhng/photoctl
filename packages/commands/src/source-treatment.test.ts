import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { decodeLibraw } from "@photoctl/img";
import { graphNodeDataSchema, graphShowDataSchema, showDataSchema } from "@photoctl/protocol";
import { artifactPath, readArtifactLinear } from "@photoctl/render";
import { dispatch } from "./dispatch.js";

test("ordinary RAW rendering uses the measured native treatment while an untouched overview stays cheap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-source-treatment-"));
  const { handle } = await initializeLibrary(join(directory, "library"));
  const env = {
    noDaemon: true,
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
      decoderId: "file",
      status: "not-applicable",
    });
    expect(
      (await handle.query("SELECT execution_id FROM node_executions WHERE photo_id = $1", [id]))
        .rows,
    ).toEqual([]);
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
    // This is a policy-wiring check, not cross-platform float equivalence.
    // Native reconstruction's independent pixel invariants live in @photoctl/img.
    const expected = await decodeLibraw(
      resolve("fixtures/camera/DSC00107.ARW"),
      1,
      "scene-linear-rec2020",
      "reconstruct",
    );
    expect([image.w, image.h]).toEqual([expected.width, expected.height]);
    expect(
      createHash("sha256")
        .update(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength))
        .digest("hex"),
    ).toBe(
      createHash("sha256")
        .update(Buffer.from(expected.data.buffer, expected.data.byteOffset, expected.data.byteLength))
        .digest("hex"),
    );
    expect(shown.render_hash).toBe(graph.render_hash);
    env.volumeMap = `${process.cwd()}=camera:offline`;
    const offline = showDataSchema.parse(await run("show", [id, "--preview-size", "300"]));
    expect(offline.preview_info.source_treatment).toEqual(execution.source_treatment);
    expect(offline.preview).toBe(shown.preview);
    expect(offline.render_hash).toBe(shown.render_hash);
    env.volumeMap = `${process.cwd()}=camera:online`;
    const reconnected = showDataSchema.parse(await run("show", [id, "--preview-size", "300"]));
    expect(reconnected.preview_info.source_treatment).toEqual(execution.source_treatment);
    expect(reconnected.render_hash).toBe(shown.render_hash);
  } finally {
    await handle.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
