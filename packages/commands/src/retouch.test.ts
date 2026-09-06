import { initializeLibrary } from "@photoctl/library";
import { retouchDataSchema } from "@photoctl/protocol";
import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "./dispatch.js";

const directories: string[] = [];
afterEach(
  async () => await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))),
);

test("retouch resolves normalized geometry and exact retries without eager pixels", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-retouch-"));
  directories.push(parent);
  const library = await initializeLibrary(join(parent, "library"));
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c401";
  const wideId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c404";
  try {
    await library.handle.query(
      `WITH seed (id, content_key, size, w, h, orientation) AS (VALUES ($1,'ck_1234567890abcdef',1,100,50,1),
       ($2,'ck_4234567890abcdef',1,4032,10,1)), inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation) SELECT id::uuid, id::uuid, w::integer, h::integer, orientation::integer FROM seed RETURNING id) INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation) SELECT id::uuid, id::uuid, 'image', content_key, size::bigint, w::integer, h::integer, orientation::integer FROM seed`,
      [id, wideId],
    );
    const first = retouchDataSchema.parse(
      success(
        await command(library.handle, parent, [id, "--at", "0.5,0.5", "--radius", "0.1", "--norm"]),
      ),
    );
    expect(first).toMatchObject({
      id,
      at: [50, 25],
      radius: 10,
      reused: false,
    });
    const nodesBeforeRepeat = (
      await library.handle.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM image_nodes",
      )
    ).rows[0]!.count;
    const repeated = retouchDataSchema.parse(
      success(await command(library.handle, parent, [id, "--at", "50,25", "--radius", "10"])),
    );
    expect(repeated).toEqual({ ...first, reused: true });
    expect(
      (
        await library.handle.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM image_nodes",
        )
      ).rows[0]!.count,
    ).toBe(nodesBeforeRepeat);
    expect(
      (
        await library.handle.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM document_revisions",
        )
      ).rows[0]?.count,
    ).toBe("2");
    expect(
      (
        await library.handle.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM node_executions",
        )
      ).rows[0]?.count,
    ).toBe("0");
    expect(first).not.toHaveProperty("preview");
    const normalizedWide = retouchDataSchema.parse(
      success(
        await command(library.handle, parent, [
          wideId,
          "--at",
          "0.1,0.5",
          "--radius",
          "0.001",
          "--norm",
        ]),
      ),
    );
    const absoluteWide = retouchDataSchema.parse(
      success(
        await command(library.handle, parent, [wideId, "--at", "403.2,5", "--radius", "4.032"]),
      ),
    );
    expect(absoluteWide).toEqual({ ...normalizedWide, reused: true });
  } finally {
    await library.handle.close();
  }
});

test("retouch uses oriented photographic support and rejects invalid target geometry", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-retouch-oriented-"));
  directories.push(parent);
  const library = await initializeLibrary(join(parent, "library"));
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c402";
  const defaultId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c403";
  const invalidId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c405";
  try {
    await library.handle.query(
      `WITH seed (id, content_key, size, w, h, orientation) AS (VALUES ($1,'ck_2234567890abcdef',1,50,100,6),
       ($2,'ck_3234567890abcdef',1,100,50,1),
       ($3,'ck_5234567890abcdef',1,100,50,1)), inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation) SELECT id::uuid, id::uuid, w::integer, h::integer, orientation::integer FROM seed RETURNING id) INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation) SELECT id::uuid, id::uuid, 'image', content_key, size::bigint, w::integer, h::integer, orientation::integer FROM seed`,
      [id, defaultId, invalidId],
    );
    const result = retouchDataSchema.parse(
      success(
        await command(library.handle, parent, [
          id,
          "--at",
          "0.5,0.25",
          "--radius",
          "0.1",
          "--norm",
        ]),
      ),
    );
    expect(result).toMatchObject({ at: [25, 25], radius: 10 });
    expect(
      retouchDataSchema.parse(
        success(await command(library.handle, parent, [defaultId, "--at", "50,25"])),
      ),
    ).toMatchObject({ radius: 2 });
    for (const [at, expected] of [
      ["-0.25,10.5", [-0.25, 10.5]],
      ["50.25,10.5", [50.25, 10.5]],
    ] as const) {
      expect(
        retouchDataSchema.parse(
          success(await command(library.handle, parent, [id, "--at", at, "--radius", "1"])),
        ),
      ).toMatchObject({ at: expected, radius: 1, reused: false });
    }
    expect(await command(library.handle, parent, [id, "--at", "53,20"])).toMatchObject({
      ok: false,
      code: "usage",
    });
    expect(
      await command(library.handle, parent, [id, "--at", "20,20", "--radius", "0"]),
    ).toMatchObject({ ok: false, code: "usage" });
    expect(
      await command(library.handle, parent, [invalidId, "--at", "25,25", "--radius", "100"]),
    ).toMatchObject({ ok: false, code: "usage" });
    expect(
      (
        await library.handle.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM photo_documents WHERE photo_id = $1",
          [invalidId],
        )
      ).rows[0]!.count,
    ).toBe("0");
  } finally {
    await library.handle.close();
  }
});

test("an authored retouch retry survives a hiding crop while a fresh excluded circle is rejected", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-retouch-retry-domain-"));
  directories.push(parent);
  const library = await initializeLibrary(join(parent, "library"));
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c406";
  try {
    await library.handle.query(
      `WITH inserted AS (
        INSERT INTO photos (id, primary_original_id, w, h, orientation)
        VALUES ($1, $1, 100, 50, 1)
      ) INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation)
        VALUES ($1, $1, 'image', 'ck_6234567890abcdef', 1, 100, 50, 1)`,
      [id],
    );
    const authored = retouchDataSchema.parse(
      success(await command(library.handle, parent, [id, "--at", "10,10", "--radius", "2"])),
    );
    const cropped = await dispatch(
      {
        verb: "develop",
        args: [id, "--set", 'crop={"x":50,"y":0,"w":50,"h":50}'],
        cwd: parent,
        env: { libraryDir: library.handle.path },
      },
      { version: "test", library: library.handle },
    );
    expect(cropped).toMatchObject({ ok: true });
    const snapshot = async () =>
      (
        await library.handle.query(
          "SELECT active_revision_id FROM photo_documents WHERE photo_id = $1",
          [id],
        )
      ).rows;
    const before = await snapshot();
    const repeated = retouchDataSchema.parse(
      success(await command(library.handle, parent, [id, "--at", "10,10", "--radius", "2"])),
    );
    expect(repeated).toMatchObject({
      layer_id: authored.layer_id,
      node: authored.node,
      at: [10, 10],
      radius: 2,
      reused: true,
    });
    expect(
      await command(library.handle, parent, [id, "--at", "11,10", "--radius", "2"]),
    ).toMatchObject({ ok: false, code: "usage" });
    expect(await snapshot()).toEqual(before);
  } finally {
    await library.handle.close();
  }
});

async function command(
  handle: Awaited<ReturnType<typeof initializeLibrary>>["handle"],
  cwd: string,
  args: string[],
) {
  return await dispatch(
    { verb: "retouch", args, cwd, env: { libraryDir: handle.path } },
    { version: "test", library: handle },
  );
}
function success(envelope: Awaited<ReturnType<typeof dispatch>>) {
  if (!envelope.ok || !("data" in envelope)) throw new Error(JSON.stringify(envelope));
  return envelope.data;
}
