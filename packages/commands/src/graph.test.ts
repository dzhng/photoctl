import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { graphShowDataSchema, graphNodeDataSchema } from "@photoctl/protocol";
import { dispatch } from "./dispatch.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("graph show and node expose bounded full-identity records", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-graph-command-"));
  directories.push(parent);
  const initialized = await initializeLibrary(join(parent, "library"));
  const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c031";
  try {
    await initialized.handle.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_34567890abcdef12', 1, 10, 20, 6)`,
      [photoId],
    );
    const shown = await dispatch(
      {
        verb: "graph",
        args: ["show", photoId, "--layer", "output", "--limit", "1"],
        cwd: parent,
        env: { noDaemon: true },
      },
      { version: "test", library: initialized.handle },
    );
    expect(shown.ok).toBe(true);
    if (!shown.ok) return;
    const page = graphShowDataSchema.parse(shown.data);
    expect(page.nodes).toHaveLength(1);
    expect(page.next_cursor).toBeTypeOf("string");
    expect(page.render_hash).toMatch(/^r_[0-9a-f]{64}$/);
    expect(page.roots.output).toMatch(/^node_[0-9a-f]{64}$/);

    const inspected = await dispatch(
      {
        verb: "graph",
        args: ["node", photoId, page.roots.output],
        cwd: parent,
        env: { noDaemon: true },
      },
      { version: "test", library: initialized.handle },
    );
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    const node = graphNodeDataSchema.parse(inspected.data);
    expect(node.id).toBe(page.roots.output);
    expect(node.recipe_hash).toMatch(/^recipe_[0-9a-f]{64}$/);
  } finally {
    await initialized.handle.close();
  }
});

test("graph show pages a layer content and mask graph with a revision-and-layer-bound cursor", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-layer-graph-command-"));
  directories.push(parent);
  const initialized = await initializeLibrary(join(parent, "library"));
  const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c032";
  try {
    await initialized.handle.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_4567890abcdef124', 1, 3, 2, 1)`,
      [photoId],
    );
    const segmented = await dispatch(
      {
        verb: "segment",
        args: [photoId, "--box", "0,0,1,1"],
        cwd: parent,
        env: { noDaemon: true },
      },
      { version: "test", library: initialized.handle },
    );
    if (!segmented.ok) throw new Error("segment failed");
    const layerId = (segmented.data as { layer_id: string }).layer_id;
    const first = await dispatch(
      {
        verb: "graph",
        args: ["show", photoId, "--layer", layerId, "--limit", "1"],
        cwd: parent,
        env: { noDaemon: true },
      },
      { version: "test", library: initialized.handle },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstPage = graphShowDataSchema.parse(first.data);
    expect(firstPage.scope).toEqual({ root: "layer", layer_id: layerId, history: false });
    expect(firstPage.roots).toEqual({
      content: expect.stringMatching(/^node_[0-9a-f]{64}$/),
      mask: expect.stringMatching(/^node_[0-9a-f]{64}$/),
    });
    expect(firstPage.nodes).toHaveLength(1);
    expect(firstPage.next_cursor).toBeTypeOf("string");

    const second = await dispatch(
      {
        verb: "graph",
        args: [
          "show",
          photoId,
          "--layer",
          layerId,
          "--limit",
          "1",
          "--cursor",
          firstPage.next_cursor!,
        ],
        cwd: parent,
        env: { noDaemon: true },
      },
      { version: "test", library: initialized.handle },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const secondPage = graphShowDataSchema.parse(second.data);
    expect(secondPage.revision_id).toBe(firstPage.revision_id);
    expect(secondPage.nodes[0]?.id).not.toBe(firstPage.nodes[0]?.id);

    const wrongScope = await dispatch(
      {
        verb: "graph",
        args: ["show", photoId, "--layer", "output", "--cursor", firstPage.next_cursor!],
        cwd: parent,
        env: { noDaemon: true },
      },
      { version: "test", library: initialized.handle },
    );
    expect(wrongScope).toMatchObject({ ok: false, code: "usage" });
  } finally {
    await initialized.handle.close();
  }
});
