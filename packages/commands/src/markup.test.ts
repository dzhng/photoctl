import { initializeLibrary } from "@photoctl/library";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

const directories: string[] = [];
afterEach(
  async () => await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))),
);

test("markup add/list/update/remove/clear round-trips strict vector items", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-markup-command-"));
  directories.push(parent);
  const initialized = await initializeLibrary(join(parent, "library"));
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c173";
  try {
    await initialized.handle.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_markup_command', 1, 12, 9, 1)`,
      [id],
    );
    const rect = { type: "rect", bbox: [3, 2, 5, 4], width: 1, color: "#ff0000", fill: "#ff0000" };
    const added = success(
      await command(initialized.handle, parent, ["add", id, "--json", JSON.stringify(rect)]),
    );
    expect(added).toMatchObject({
      id,
      changed: "add",
      items: [{ ...rect, id: expect.any(String) }],
    });
    const itemId = (added.items as Array<{ id: string }>)[0]!.id;
    const listed = success(await command(initialized.handle, parent, ["list", id]));
    expect(listed).toEqual({ ...added, changed: null });

    const line = { type: "line", from: [1, 1], to: [8, 7], width: 2, color: "#00ff00" };
    const updated = success(
      await command(initialized.handle, parent, [
        "update",
        id,
        itemId.slice(0, 12),
        "--json",
        JSON.stringify(line),
      ]),
    );
    expect(updated).toMatchObject({ id, changed: "update", items: [{ ...line, id: itemId }] });

    const removed = success(await command(initialized.handle, parent, ["remove", id, itemId]));
    expect(removed).toMatchObject({ id, changed: "remove", items: [] });
    const cleared = success(await command(initialized.handle, parent, ["clear", id]));
    expect(cleared).toEqual({ ...removed, changed: null });

    const beforeInvalid = await activeRevision(initialized.handle, id);
    expect(
      await command(initialized.handle, parent, ["add", id, "--json", '{"type":"rect"}']),
    ).toMatchObject({ ok: false, code: "usage" });
    expect(await activeRevision(initialized.handle, id)).toBe(beforeInvalid);
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
    { verb: "markup", args, cwd, env: { noDaemon: true } },
    { version: "test", library: handle },
  );
}
function success(envelope: Awaited<ReturnType<typeof dispatch>>): Record<string, unknown> {
  expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
  if (!envelope.ok || !("data" in envelope)) throw new Error(JSON.stringify(envelope));
  return envelope.data as Record<string, unknown>;
}
async function activeRevision(
  handle: Awaited<ReturnType<typeof initializeLibrary>>["handle"],
  id: string,
) {
  return (
    await handle.query<{ active_revision_id: string }>(
      "SELECT active_revision_id::text FROM photo_documents WHERE photo_id = $1",
      [id],
    )
  ).rows[0]!.active_revision_id;
}
