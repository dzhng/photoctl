import { initializeLibrary } from "@photoctl/library";
import {
  generateDataSchema,
  markupDataSchema,
  segmentDataSchema,
  showDataSchema,
  undoDataSchema,
} from "@photoctl/protocol";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test("undo preserves a generated initial root and atomically restores markup and layer snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-generated-undo-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  let requests = 0;
  const gateway = await startGatewayFixture(0, {
    onImageRequest: () => {
      requests++;
    },
  });
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("Fixture unavailable");
  const env = {
    noDaemon: true,
    cacheRoot: join(directory, "cache"),
    gatewayApiKey: "fixture",
    gatewayUrl: `http://127.0.0.1:${address.port}`,
  };
  const command = async (verb: string, args: string[]) => {
    const result = await dispatch(
      { verb, args, cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok || !("data" in result)) throw new Error("Expected command data");
    return result.data;
  };
  try {
    const generated = generateDataSchema.parse(
      await command("generate", ["--prompt", "blue field", "--size", "16x12"]),
    );
    const id = generated.id;
    const initial = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    const initialBytes = await readFile(initial.preview);
    const noOp = undoDataSchema.parse(await command("undo", [id.slice(0, 12)]));
    expect(noOp).toEqual({
      id,
      undone: false,
      revision_id: generated.revision_id,
      render_hash: generated.render_hash,
    });
    const retained = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    expect(retained.render_hash).toBe(generated.render_hash);
    expect(await readFile(retained.preview)).toEqual(initialBytes);

    const segment = segmentDataSchema.parse(await command("segment", [id, "--box", "2,2,5,4"]));
    const marked = markupDataSchema.parse(
      await command("markup", [
        "add",
        id,
        "--json",
        JSON.stringify({
          type: "rect",
          bbox: [1, 1, 4, 3],
          width: 1,
          color: "#ff0000",
          fill: "#ff0000",
        }),
      ]),
    );
    const layers = await command("layer", ["list", id]);
    const markedPreview = showDataSchema.parse(
      await command("show", [id, "--preview-size", "native"]),
    );
    const markedBytes = await readFile(markedPreview.preview);
    expect(markedBytes).not.toEqual(initialBytes);
    await command("layer", ["remove", id, segment.layer_id]);
    const removedLayers = await command("layer", ["list", id]);
    await command("markup", ["clear", id]);
    await command("undo", [id]);
    expect(await command("markup", ["list", id])).toMatchObject({
      items: marked.items,
    });
    expect(await command("layer", ["list", id])).toEqual(removedLayers);
    await command("undo", [id]);
    expect(await command("layer", ["list", id])).toEqual(layers);
    const restored = showDataSchema.parse(await command("show", [id, "--preview-size", "native"]));
    expect(restored.render_hash).toBe(markedPreview.render_hash);
    expect(await readFile(restored.preview)).toEqual(markedBytes);
    expect(requests).toBe(1);
    expect(
      (
        await initialized.handle.query(
          "SELECT count(*)::text AS count FROM document_revisions WHERE photo_id = $1",
          [id],
        )
      ).rows,
    ).toEqual([{ count: "5" }]);
  } finally {
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
}, 30_000);
