import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../../../library/src/migrations/runner.js";
import { expect, test } from "vitest";
import { commitRevision, ensurePhotoDocument, setRevisionPinned, undoRevision } from "./store.js";

const firstPhoto = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
const secondPhoto = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002";

test("one revision atomically stores a chain with ordered shared inputs and redirects output", async () => {
  const db = await graphDatabase();
  try {
    const committed = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [
        source("source"),
        develop("bright", { localKey: "source" }, 1),
        develop("dark", { localKey: "source" }, -1),
        {
          localKey: "composite",
          kind: "composite",
          recipeVersion: 1,
          parameters: { opacity: 1 },
          inputs: [{ localKey: "dark" }, { localKey: "bright" }, { localKey: "dark" }],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "composite" } }],
    });

    const inputs = await db.query<{ input_index: number; input_node_id: string }>(
      `SELECT input_index, input_node_id FROM image_node_inputs
       WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index`,
      [firstPhoto, committed.nodes.composite.id],
    );
    expect(inputs.rows).toEqual([
      { input_index: 0, input_node_id: committed.nodes.dark.id },
      { input_index: 1, input_node_id: committed.nodes.bright.id },
      { input_index: 2, input_node_id: committed.nodes.dark.id },
    ]);
    expect(committed.roots).toEqual({ output: committed.nodes.composite.id });
    expect(committed.renderHash).toMatch(/^r_[0-9a-f]{64}$/);
  } finally {
    await db.close();
  }
});

test("concurrent source document initialization converges on one active revision", async () => {
  const db = await graphDatabase();
  try {
    const initialized = await Promise.all([
      ensurePhotoDocument(db, { photoId: firstPhoto, orientation: 1 }),
      ensurePhotoDocument(db, { photoId: firstPhoto, orientation: 1 }),
    ]);

    expect(initialized[0]).toEqual(initialized[1]);
    expect(
      (await db.query<{ count: string }>("SELECT count(*)::text AS count FROM document_revisions"))
        .rows,
    ).toEqual([{ count: "1" }]);
  } finally {
    await db.close();
  }
});

test("logical mutations are immutable, lazy, CAS-protected, and undoable", async () => {
  const db = await graphDatabase();
  try {
    const original = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [source("source")],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });
    const edited = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: original.revisionId,
      nodes: [develop("edit", { nodeId: original.nodes.source.id }, 1)],
      rootUpdates: [{ root: "output", node: { localKey: "edit" } }],
    });

    expect(edited.renderHash).not.toBe(original.renderHash);
    expect((await db.query("SELECT 1 FROM node_executions")).rows).toEqual([]);
    await setRevisionPinned(db, {
      photoId: firstPhoto,
      revisionId: original.revisionId,
      pinned: true,
    });
    expect(
      (
        await db.query<{ pinned: boolean }>(
          "SELECT pinned FROM document_revisions WHERE photo_id = $1 AND id = $2",
          [firstPhoto, original.revisionId],
        )
      ).rows,
    ).toEqual([{ pinned: true }]);
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: original.revisionId,
        nodes: [develop("stale", { nodeId: original.nodes.source.id }, 2)],
        rootUpdates: [{ root: "output", node: { localKey: "stale" } }],
      }),
    ).rejects.toThrow("document changed");
    const undone = await undoRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: edited.revisionId,
    });
    expect(undone).toEqual({ revisionId: original.revisionId, renderHash: original.renderHash });
    expect(
      (await db.query<{ count: string }>("SELECT count(*)::text AS count FROM image_nodes")).rows,
    ).toEqual([{ count: "2" }]);
  } finally {
    await db.close();
  }
});

test("local cycles and cross-photo edges roll back without partial graph state", async () => {
  const db = await graphDatabase();
  try {
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [
          develop("left", { localKey: "right" }, 1),
          develop("right", { localKey: "left" }, 2),
        ],
        rootUpdates: [{ root: "output", node: { localKey: "left" } }],
      }),
    ).rejects.toThrow("cycle refused");
    expect((await db.query("SELECT 1 FROM image_nodes")).rows).toEqual([]);

    const first = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [source("source")],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });
    await expect(
      commitRevision(db, {
        photoId: secondPhoto,
        expectedRevisionId: null,
        nodes: [develop("foreign", { nodeId: first.nodes.source.id }, 1)],
        rootUpdates: [{ root: "output", node: { localKey: "foreign" } }],
      }),
    ).rejects.toThrow("does not exist for photo");
  } finally {
    await db.close();
  }
});

test("the same logical recipe is valid in two photo-scoped graphs", async () => {
  const db = await graphDatabase();
  try {
    const first = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [source("source")],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });
    const second = await commitRevision(db, {
      photoId: secondPhoto,
      expectedRevisionId: null,
      nodes: [source("source")],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });

    expect(first.nodes.source.id).toBe(second.nodes.source.id);
    const owners = await db.query<{ photo_id: string }>(
      "SELECT photo_id::text FROM image_nodes WHERE id = $1 ORDER BY photo_id",
      [first.nodes.source.id],
    );
    expect(owners.rows).toEqual([{ photo_id: firstPhoto }, { photo_id: secondPhoto }]);
  } finally {
    await db.close();
  }
});

test("revision inheritance stays in its photo when revision UUIDs repeat", async () => {
  const db = await graphDatabase();
  try {
    const first = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [source("first-source")],
      rootUpdates: [{ root: "output", node: { localKey: "first-source" } }],
    });
    const second = await commitRevision(db, {
      photoId: secondPhoto,
      expectedRevisionId: null,
      nodes: [source("second-source")],
      rootUpdates: [{ root: "output", node: { localKey: "second-source" } }],
    });
    await db.query("INSERT INTO document_revisions (id, photo_id) VALUES ($1, $2)", [
      first.revisionId,
      secondPhoto,
    ]);
    await db.query(
      `INSERT INTO document_revision_roots (revision_id, photo_id, root_name, node_id)
       VALUES ($1, $2, 'output', $3)`,
      [first.revisionId, secondPhoto, second.nodes["second-source"].id],
    );

    const edited = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: first.revisionId,
      nodes: [develop("edit", { nodeId: first.nodes["first-source"].id }, 1)],
      rootUpdates: [{ root: "output", node: { localKey: "edit" } }],
    });

    expect(edited.roots).toEqual({ output: edited.nodes.edit.id });
  } finally {
    await db.close();
  }
});

test("a paid nondeterministic ancestor cannot become active before artifact publication", async () => {
  const db = await graphDatabase();
  try {
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [
          source("source"),
          {
            localKey: "generated",
            kind: "generate",
            recipeVersion: 1,
            parameters: { model: "paid-v1", prompt: "restore", prompt_version: 1, request: {} },
            inputs: [{ localKey: "source" }],
          },
          {
            localKey: "output",
            kind: "output",
            recipeVersion: 1,
            parameters: { format: "display-rgb", color_space: "srgb" },
            inputs: [{ localKey: "generated" }],
          },
        ],
        rootUpdates: [{ root: "output", node: { localKey: "output" } }],
      }),
    ).rejects.toThrow("before its artifact is published");
    expect((await db.query("SELECT 1 FROM image_nodes")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});

test("unreachable drafts and node-only revisions are refused without debris", async () => {
  const db = await graphDatabase();
  try {
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [source("source"), develop("orphan", { localKey: "source" }, 1)],
        rootUpdates: [{ root: "output", node: { localKey: "source" } }],
      }),
    ).rejects.toThrow("reachable");
    await expect(
      commitRevision(db, {
        photoId: firstPhoto,
        expectedRevisionId: null,
        nodes: [source("source")],
        rootUpdates: [],
      }),
    ).rejects.toThrow("redirect at least one");
    expect((await db.query("SELECT 1 FROM image_nodes")).rows).toEqual([]);
    expect((await db.query("SELECT 1 FROM document_revisions")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});

test("a revision may redirect its root to an existing node without adding nodes", async () => {
  const db = await graphDatabase();
  try {
    const initial = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: null,
      nodes: [source("source")],
      rootUpdates: [{ root: "output", node: { localKey: "source" } }],
    });
    const redirected = await commitRevision(db, {
      photoId: firstPhoto,
      expectedRevisionId: initial.revisionId,
      nodes: [],
      rootUpdates: [{ root: "output", node: { nodeId: initial.nodes.source.id } }],
    });

    expect(redirected.renderHash).toBe(initial.renderHash);
    expect(
      (await db.query<{ count: string }>("SELECT count(*)::text AS count FROM image_nodes")).rows,
    ).toEqual([{ count: "1" }]);
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

function develop(
  localKey: string,
  input: { localKey: string } | { nodeId: string },
  exposure: number,
) {
  return {
    localKey,
    kind: "develop" as const,
    recipeVersion: 1,
    parameters: { exposure },
    inputs: [input],
  };
}

async function graphDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  await migrate(db);
  await db.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_3dac5c943a33dcc4', 1, 1, 1, 1),
            ($2, 'ck_aaaaaaaaaaaaaaaa', 1, 1, 1, 1)`,
    [firstPhoto, secondPhoto],
  );
  return db;
}
