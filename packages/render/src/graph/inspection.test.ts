/* eslint-disable no-await-in-loop -- The test constructs and consumes an ordered revision/page chain. */
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";
import { migrate } from "../../../library/src/migrations/runner.js";
import { inspectGraph } from "./inspection.js";
import { commitRevision } from "./store.js";

const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c021";

test("history pagination is bounded, duplicate-free, and remains bound to its starting revision", async () => {
  const db = await PGlite.create();
  await migrate(db);
  await db.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_234567890abcdef1', 1, 1, 1, 1)`,
    [photoId],
  );
  try {
    let revision = await commitRevision(db, {
      photoId,
      expectedRevisionId: null,
      nodes: [source("source")],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });
    for (let index = 0; index < 6; index += 1) {
      revision = await commitRevision(db, {
        photoId,
        expectedRevisionId: revision.revisionId,
        nodes: [develop(`edit-${index}`, { nodeId: revision.roots.output! }, index)],
        rootUpdates: [{ root: "output", node: { localKey: `edit-${index}` } }],
      });
    }

    const first = await inspectGraph(db, { photoId, history: true, limit: 3 });
    expect(first.revisionId).toBe(revision.revisionId);
    expect(first.nodes).toHaveLength(3);
    expect(first.nextCursor).toBeTypeOf("string");
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(1024 * 1024);

    const newer = await commitRevision(db, {
      photoId,
      expectedRevisionId: revision.revisionId,
      nodes: [develop("newer", { nodeId: revision.roots.output! }, -1)],
      rootUpdates: [{ root: "output", node: { localKey: "newer" } }],
    });
    const pages = [first];
    while (pages.at(-1)!.nextCursor) {
      pages.push(
        await inspectGraph(db, {
          photoId,
          history: true,
          limit: 3,
          cursor: pages.at(-1)!.nextCursor!,
        }),
      );
    }
    const nodeIds = pages.flatMap((page) => page.nodes.map((node) => node.id));
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(nodeIds).toHaveLength(7);
    expect(pages.every((page) => page.nodes.length <= 3)).toBe(true);
    expect(pages.every((page) => page.revisionId === revision.revisionId)).toBe(true);
    expect(nodeIds).not.toContain(newer.nodes.newer.id);
  } finally {
    await db.close();
  }
});

test("cursor structure is validated before it reaches database casts", async () => {
  const db = await PGlite.create();
  await migrate(db);
  try {
    const payload = Buffer.from(
      JSON.stringify({
        photoId,
        revisionId: "not-a-revision",
        history: false,
        afterNodeId: `node_${"a".repeat(64)}`,
      }),
    ).toString("base64url");
    const checksum = createHash("sha256").update(payload).digest("hex");

    await expect(inspectGraph(db, { photoId, cursor: `${payload}.${checksum}` })).rejects.toThrow(
      "Invalid graph cursor",
    );
  } finally {
    await db.close();
  }
});

function source(localKey: string) {
  return {
    localKey,
    kind: "source" as const,
    recipeVersion: 1,
    parameters: { orientation: 1 },
    inputs: [],
  };
}

function develop(localKey: string, input: { nodeId: string }, exposure: number) {
  return {
    localKey,
    kind: "develop" as const,
    recipeVersion: 1,
    parameters: { exposure },
    inputs: [input],
  };
}
