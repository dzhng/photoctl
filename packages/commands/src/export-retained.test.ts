import { initializeLibrary } from "@photoctl/library";
import { exportResultSchema, showDataSchema } from "@photoctl/protocol";
import { artifactPath, loadActiveDocument, readRetainedGraphOutput } from "@photoctl/render";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test.each(["intact", "missing", "corrupt", "obsolete"] as const)(
  "offline export uses verified current pixels and recovers from %s retained output",
  async (state) => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-export-retained-"));
    const source = join(directory, "source.png");
    const { handle } = await initializeLibrary(join(directory, "library"));
    const env = {
      noDaemon: true,
      libraryPath: handle.path,
      cacheRoot: join(directory, "cache"),
      volumeMap: `${directory}=fixture-volume:online`,
    };
    try {
      const data = Buffer.from(
        Array.from({ length: 48 * 32 * 3 }, (_, index) => (index * 37) % 256),
      );
      await sharp(data, { raw: { width: 48, height: 32, channels: 3 } })
        .png()
        .toFile(source);
      const run = async (verb: string, args: string[]) => {
        const result = await dispatch(
          { verb, args, cwd: directory, env },
          { version: "test", library: handle },
        );
        expect(result.ok, JSON.stringify(result)).toBe(true);
        return result;
      };
      const imported = await run("import", [source, "--link"]);
      const id = (imported.data as { ids: string[] }).ids[0]!;
      await run("develop", [
        id,
        "--set",
        "exposure=0.5",
        "--set",
        'crop={"x":4,"y":3,"w":32,"h":24}',
        "--set",
        "rotate=90",
      ]);
      const exported = async (name: string) => {
        const response = await run("export", [
          id,
          "--to",
          join(directory, name),
          "--format",
          "png",
        ]);
        const result = exportResultSchema.parse(response.results![0]);
        return { response, result, pixels: await sharp(result.file).raw().toBuffer() };
      };
      const online = await exported("online");
      const shown = showDataSchema.parse(
        (await run("show", [id, "--preview-size", "native"])).data,
      );
      if (state !== "intact") {
        const artifacts = await handle.query<{ output_artifact_hash: string }>(
          `SELECT execution.output_artifact_hash FROM node_executions execution
         JOIN photo_documents document ON document.photo_id = execution.photo_id
         JOIN document_revision_roots root ON root.photo_id = document.photo_id
           AND root.revision_id = document.active_revision_id AND root.node_id = execution.node_id
         WHERE root.root_name = 'output' AND execution.photo_id = $1`,
          [id],
        );
        expect(artifacts.rows).toHaveLength(1);
        if (state === "obsolete") {
          // An older renderer can retain valid bytes for this node but not the current render identity.
          await handle.query(
            "UPDATE node_executions SET render_identity = $2 WHERE output_artifact_hash = $1",
            [artifacts.rows[0]!.output_artifact_hash, `r_${"0".repeat(64)}`],
          );
        } else {
          const path = artifactPath(handle.path, artifacts.rows[0]!.output_artifact_hash, "tif");
          if (state === "missing") await rm(path);
          else await writeFile(path, "corrupt canonical artifact");
        }
      }
      await rename(source, `${source}.offline`);
      env.volumeMap = `${directory}=fixture-volume:offline`;
      const offline = await exported("offline");
      expect(offline.result.render_hash).toBe(shown.render_hash);
      expect(offline.result.render_hash).toBe(online.result.render_hash);
      expect(offline.pixels.equals(online.pixels)).toBe(state === "intact");
      expect(offline.response.warnings).toContainEqual(
        expect.objectContaining({ code: "source_offline" }),
      );
      if (state === "missing" || state === "corrupt") {
        const document = await loadActiveDocument(handle, id);
        const retained = {
          database: handle,
          libraryPath: handle.path,
          photoId: id,
          nodeId: document!.roots.output,
        };
        expect(
          await readRetainedGraphOutput({
            ...retained,
            minimumSource: { dimensions: { w: 48, h: 32 }, tier: "pinned-preview" },
          }),
        ).toBeDefined();
        expect(
          await readRetainedGraphOutput({
            ...retained,
            minimumSource: { dimensions: { w: 48, h: 32 }, tier: "online-jpeg-range" },
          }),
        ).toBeUndefined();
        expect(
          await readRetainedGraphOutput({
            ...retained,
            minimumSource: { dimensions: { w: 96, h: 64 }, tier: "pinned-preview" },
          }),
        ).toBeUndefined();
      }
      await rename(`${source}.offline`, source);
      env.volumeMap = `${directory}=fixture-volume:online`;
      const reconnected = await exported("reconnected");
      expect(reconnected.pixels.equals(online.pixels)).toBe(true);
      expect(reconnected.response.warnings).not.toContainEqual(
        expect.objectContaining({ code: "source_offline" }),
      );
      if (state === "missing" || state === "corrupt") {
        await rename(source, `${source}.offline`);
        env.volumeMap = `${directory}=fixture-volume:offline`;
        const retainedAgain = await exported("offline-after-reconnect");
        expect(retainedAgain.pixels.equals(online.pixels)).toBe(true);
        expect(retainedAgain.pixels.equals(offline.pixels)).toBe(false);
      }
    } finally {
      await handle.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
