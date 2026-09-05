import { initializeLibrary } from "@photoctl/library";
import { FAKE_IMAGE_EDIT_MODEL } from "@photoctl/providers";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test("reimagine adds a lazy full-frame layer and removing it restores the prior render", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-reimagine-"));
  const source = join(parent, "source.jpg");
  const library = await initializeLibrary(join(parent, "library"));
  const requests: string[] = [];
  const gateway = await startGatewayFixture(0, {
    imageMode: "smallerdims",
    onRequest: ({ path }) => requests.push(path),
  });
  try {
    await sharp({ create: { width: 40, height: 30, channels: 3, background: "#406080" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(source);
    const address = gateway.address();
    if (!address || typeof address === "string") throw new Error("Fixture gateway unavailable");
    const env = {
      noDaemon: true,
      cacheRoot: join(parent, "cache"),
      volumeMap: `${parent}=fixture-volume:online`,
      gatewayApiKey: "fixture-key",
      gatewayUrl: `http://127.0.0.1:${address.port}`,
    };
    await library.handle.query(
      `INSERT INTO settings (key, value) VALUES
       ('models', $1::jsonb),
       ('providers', $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [
        JSON.stringify({ edit: FAKE_IMAGE_EDIT_MODEL }),
        JSON.stringify({ upscale: { "photoctl/fake-upscale-v1": { configured: true } } }),
      ],
    );
    const imported = success(
      await dispatch(
        { verb: "import", args: [source, "--link"], cwd: parent, env },
        { version: "test", library: library.handle },
      ),
    ) as { ids: string[] };
    const id = imported.ids[0]!;
    const before = success(
      await dispatch(
        { verb: "show", args: [id, "--preview-size", "native"], cwd: parent, env },
        { version: "test", library: library.handle },
      ),
    ) as { preview: string; render_hash: string };
    const beforePixels = await readFile(before.preview);
    const libraryId = (
      await library.handle.query<{ value: string }>(
        "SELECT value #>> '{}' AS value FROM settings WHERE key = 'library_id'",
      )
    ).rows[0]!.value;

    const changed = success(
      await dispatch(
        { verb: "reimagine", args: [id, "--prompt", "painted twilight"], cwd: parent, env },
        { version: "test", library: library.handle },
      ),
    ) as {
      layer_id: string;
      revision_id: string;
      render_hash: string;
      drift: string;
      generation: { returned: { w: number; h: number } };
      upscale: { executed: boolean; final: { w: number; h: number } };
    };
    expect(changed).toMatchObject({
      id,
      drift: "full-frame",
      generation: { returned: { w: 15, h: 20 } },
      source_context: { pixel_scale: 1, resolution_limited: false },
      upscale: { executed: true, final: { w: 30, h: 40 } },
    });
    expect(changed.render_hash).not.toBe(before.render_hash);
    expect(requests).toEqual(["/v1/images/edits"]);
    await expect(
      access(join(parent, "cache", libraryId, "view", id, changed.render_hash)),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const after = success(
      await dispatch(
        { verb: "show", args: [id, "--preview-size", "native"], cwd: parent, env },
        { version: "test", library: library.handle },
      ),
    ) as { preview: string; render_hash: string };
    expect(after.render_hash).toBe(changed.render_hash);
    expect(await sharp(after.preview).metadata()).toMatchObject({ width: 30, height: 40 });
    expect(await readFile(after.preview)).not.toEqual(beforePixels);
    expect(requests).toEqual(["/v1/images/edits"]);

    const removed = success(
      await dispatch(
        { verb: "layer", args: ["remove", id, changed.layer_id], cwd: parent, env },
        { version: "test", library: library.handle },
      ),
    ) as { render_hash: string };
    expect(removed.render_hash).toBe(before.render_hash);
    const restored = success(
      await dispatch(
        { verb: "show", args: [id, "--preview-size", "native"], cwd: parent, env },
        { version: "test", library: library.handle },
      ),
    ) as { preview: string; render_hash: string };
    expect(restored.render_hash).toBe(before.render_hash);
    expect(await readFile(restored.preview)).toEqual(beforePixels);
    expect(requests).toEqual(["/v1/images/edits"]);

    const zeroStrength = success(
      await dispatch(
        {
          verb: "reimagine",
          args: [id, "--prompt", "hidden alternate", "--strength", "0"],
          cwd: parent,
          env,
        },
        { version: "test", library: library.handle },
      ),
    ) as { layer_id: string; render_hash: string; strength: number };
    expect(zeroStrength).toMatchObject({ strength: 0 });
    expect(zeroStrength.render_hash).not.toBe(before.render_hash);
    const zeroRendered = success(
      await dispatch(
        { verb: "show", args: [id, "--preview-size", "native"], cwd: parent, env },
        { version: "test", library: library.handle },
      ),
    ) as { preview: string };
    expect(await readFile(zeroRendered.preview)).toEqual(beforePixels);
    expect(requests).toEqual(["/v1/images/edits", "/v1/images/edits"]);
    success(
      await dispatch(
        { verb: "layer", args: ["remove", id, zeroStrength.layer_id], cwd: parent, env },
        { version: "test", library: library.handle },
      ),
    );

    const croppedEnvelope = await dispatch(
      {
        verb: "develop",
        args: [id, "--set", 'crop={"x":5,"y":5,"w":20,"h":10}', "rotate=90"],
        cwd: parent,
        env,
      },
      { version: "test", library: library.handle },
    );
    expect(croppedEnvelope).toMatchObject({ ok: true });
    const activeBeforeRefusal = (
      await library.handle.query<{ active_revision_id: string }>(
        "SELECT active_revision_id::text FROM photo_documents WHERE photo_id = $1",
        [id],
      )
    ).rows[0]!.active_revision_id;
    const refused = await dispatch(
      { verb: "reimagine", args: [id, "--prompt", "should not run"], cwd: parent, env },
      { version: "test", library: library.handle },
    );
    expect(refused).toMatchObject({ ok: false, code: "usage" });
    expect(requests).toEqual(["/v1/images/edits", "/v1/images/edits"]);
    const active = (
      await library.handle.query<{ active_revision_id: string }>(
        "SELECT active_revision_id::text FROM photo_documents WHERE photo_id = $1",
        [id],
      )
    ).rows[0]!;
    expect(active.active_revision_id).toBe(activeBeforeRefusal);
  } finally {
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await library.handle.close();
    await rm(parent, { recursive: true });
  }
});

function success(envelope: Awaited<ReturnType<typeof dispatch>>): unknown {
  expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
  if (!envelope.ok || !("data" in envelope)) throw new Error(JSON.stringify(envelope));
  return envelope.data;
}
