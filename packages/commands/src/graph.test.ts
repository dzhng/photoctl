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
