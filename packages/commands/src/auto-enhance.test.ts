import { initializeLibrary } from "@photoctl/library";
import { readActiveDevelopState } from "@photoctl/render";
import type { StructuredModelAdapter } from "@photoctl/providers";
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

test("a structured-provider failure leaves the active revision and develop state unchanged", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-auto-enhance-failure-"));
  directories.push(parent);
  const initialized = await initializeLibrary(join(parent, "library"));
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c160";
  try {
    await initialized.handle.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_auto_enhance_01', 1, 8, 6, 1)`,
      [id],
    );
    expect(await command(initialized.handle, parent, [id, "--set", "contrast=9"])).toMatchObject({
      ok: true,
    });
    const before = await readActiveDevelopState(initialized.handle, {
      photoId: id,
      orientation: 1,
    });
    const jpeg = await sharp({
      create: { width: 8, height: 6, channels: 3, background: "#808080" },
    })
      .jpeg()
      .toBuffer();
    const failing: StructuredModelAdapter = {
      id: "fake-structured",
      version: "1",
      ask: async () => {
        throw new Error("fixture rejection");
      },
    };

    expect(
      await dispatch(
        {
          verb: "develop",
          args: [id, "--auto-enhance"],
          cwd: parent,
          env: { noDaemon: true },
        },
        {
          version: "test",
          library: initialized.handle,
          develop: {
            structured: failing,
            image: { bytes: jpeg, mediaType: "image/jpeg", dimensions: { w: 8, h: 6 } },
          },
        },
      ),
    ).toMatchObject({
      ok: false,
      results: [{ id, ok: false, code: "provider_busy" }],
    });
    const after = await readActiveDevelopState(initialized.handle, {
      photoId: id,
      orientation: 1,
    });
    expect(after.revisionId).toBe(before.revisionId);
    expect(after.develop).toEqual({ contrast: 9 });
    expect(after.revisionMetadata).toBeNull();
  } finally {
    await initialized.handle.close();
  }
});

test("undo consumes a no-op auto-enhance marker in a new immutable revision", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-auto-enhance-noop-"));
  directories.push(parent);
  const initialized = await initializeLibrary(join(parent, "library"));
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c161";
  try {
    await initialized.handle.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_auto_enhance_02', 1, 8, 6, 1)`,
      [id],
    );
    await command(initialized.handle, parent, [id, "--set", "contrast=9"]);
    const jpeg = await sharp({
      create: { width: 8, height: 6, channels: 3, background: "#808080" },
    })
      .jpeg()
      .toBuffer();
    const stable: StructuredModelAdapter = {
      id: "fake-structured",
      version: "1",
      ask: async <Value>(schema: { parse(value: unknown): Value }) => ({
        value: schema.parse({ contrast: 9 }),
        model: "fake/structured-v1",
        requestId: "fixture-request",
        attempts: 1,
      }),
    };
    await dispatch(
      { verb: "develop", args: [id, "--auto-enhance"], cwd: parent, env: { noDaemon: true } },
      {
        version: "test",
        library: initialized.handle,
        develop: {
          structured: stable,
          image: { bytes: jpeg, mediaType: "image/jpeg", dimensions: { w: 8, h: 6 } },
        },
      },
    );
    const automatic = await readActiveDevelopState(initialized.handle, {
      photoId: id,
      orientation: 1,
    });

    expect(await command(initialized.handle, parent, [id, "--undo-auto"])).toMatchObject({
      ok: true,
    });
    const undone = await readActiveDevelopState(initialized.handle, {
      photoId: id,
      orientation: 1,
    });
    expect(undone.revisionId).not.toBe(automatic.revisionId);
    expect(undone.develop).toEqual({ contrast: 9 });
    expect(undone.revisionMetadata).toBeNull();
    expect(await command(initialized.handle, parent, [id, "--undo-auto"])).toMatchObject({
      ok: false,
      results: [{ id, ok: false, code: "usage" }],
    });
  } finally {
    await initialized.handle.close();
  }
});

async function command(
  handle: Awaited<ReturnType<typeof initializeLibrary>>["handle"],
  cwd: string,
  args: string[],
) {
  return await dispatch(
    { verb: "develop", args, cwd, env: { noDaemon: true } },
    { version: "test", library: handle },
  );
}
