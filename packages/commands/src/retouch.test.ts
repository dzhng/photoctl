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
      `INSERT INTO photos (id,content_key,size,w,h,orientation) VALUES
       ($1,'ck_1234567890abcdef',1,100,50,1),
       ($2,'ck_4234567890abcdef',1,4032,10,1)`,
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

test("retouch uses oriented bounds and rejects invalid target geometry", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-retouch-oriented-"));
  directories.push(parent);
  const library = await initializeLibrary(join(parent, "library"));
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c402";
  const defaultId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c403";
  const invalidId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c405";
  try {
    await library.handle.query(
      `INSERT INTO photos (id,content_key,size,w,h,orientation) VALUES
       ($1,'ck_2234567890abcdef',1,50,100,6),
       ($2,'ck_3234567890abcdef',1,100,50,1),
       ($3,'ck_5234567890abcdef',1,100,50,1)`,
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
    expect(await command(library.handle, parent, [id, "--at", "51,20"])).toMatchObject({
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
