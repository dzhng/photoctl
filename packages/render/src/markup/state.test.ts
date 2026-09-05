import { initializeLibrary } from "@photoctl/library";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { commitDevelopState, readActiveDevelopState } from "../develop/state.js";
import { loadActiveDocument, undoRevision } from "../graph/store.js";
import { readMarkupDocument, replaceMarkupDocument } from "./state.js";
import { createRetouchLayer } from "../retouch.js";

const directories: string[] = [];
afterEach(
  async () => await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))),
);

test("markup is atomic with its revision and remains the output wrapper after later develop", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-markup-state-"));
  directories.push(parent);
  const initialized = await initializeLibrary(join(parent, "library"));
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c171";
  try {
    await initialized.handle.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_markup_state', 1, 12, 9, 1)`,
      [id],
    );
    const before = await readActiveDevelopState(initialized.handle, {
      photoId: id,
      orientation: 1,
    });
    const document = [
      {
        id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c172",
        type: "rect" as const,
        bbox: [3, 2, 5, 4] as [number, number, number, number],
        width: 1,
        color: "#ff0000",
        fill: "#ff0000",
      },
    ];
    const marked = await replaceMarkupDocument(initialized.handle, id, before.revisionId, document);
    expect(marked.renderHash).not.toBe(before.renderHash);
    expect(await readMarkupDocument(initialized.handle, id)).toEqual(document);
    await expect(activeOutputKind(initialized.handle, id)).resolves.toBe("markup");

    const current = await readActiveDevelopState(initialized.handle, {
      photoId: id,
      orientation: 1,
    });
    const developed = await commitDevelopState(initialized.handle, current, { exposure: 0.5 });
    expect(developed.renderHash).not.toBe(marked.renderHash);
    expect(await readMarkupDocument(initialized.handle, id)).toEqual(document);
    await expect(activeOutputKind(initialized.handle, id)).resolves.toBe("markup");

    const active = await loadActiveDocument(initialized.handle, id);
    const cleared = await replaceMarkupDocument(initialized.handle, id, active!.revisionId, []);
    expect(cleared.renderHash).not.toBe(developed.renderHash);
    expect(await readMarkupDocument(initialized.handle, id)).toEqual([]);
    await expect(activeOutputKind(initialized.handle, id)).resolves.toBe("output");

    const undone = await undoRevision(initialized.handle, {
      photoId: id,
      expectedRevisionId: cleared.revisionId,
    });
    expect(undone.revisionId).toBe(active!.revisionId);
    expect(await readMarkupDocument(initialized.handle, id)).toEqual(document);
    await expect(activeOutputKind(initialized.handle, id)).resolves.toBe("markup");
  } finally {
    await initialized.handle.close();
  }
});

test("retouch consumes the markup-free pixel output", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-markup-retouch-"));
  directories.push(parent);
  const initialized = await initializeLibrary(join(parent, "library"));
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c181";
  try {
    await initialized.handle.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_markup_retouch', 1, 12, 9, 1)`,
      [id],
    );
    const before = await readActiveDevelopState(initialized.handle, {
      photoId: id,
      orientation: 1,
    });
    const marked = await replaceMarkupDocument(initialized.handle, id, before.revisionId, [
      {
        id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c182",
        type: "rect",
        bbox: [2, 2, 6, 4],
        width: 1,
        color: "#ff0000",
        fill: "#ff0000",
      },
    ]);
    const retouched = await createRetouchLayer(initialized.handle, join(parent, "library"), {
      photoId: id,
      orientation: 1,
      dimensions: { w: 12, h: 9 },
      at: [5, 4],
      radius: 2,
    });
    const input = await initialized.handle.query<{ kind: string }>(
      `SELECT input.kind
       FROM image_node_inputs AS edge
       JOIN image_nodes AS input ON input.photo_id = edge.photo_id AND input.id = edge.input_node_id
       WHERE edge.photo_id = $1 AND edge.node_id = $2 AND edge.input_index = 0`,
      [id, retouched.nodeId],
    );

    expect(marked.nodeId).not.toBe(before.pixelOutputNodeId);
    expect(input.rows).toEqual([{ kind: "output" }]);
  } finally {
    await initialized.handle.close();
  }
});

async function activeOutputKind(
  database: Awaited<ReturnType<typeof initializeLibrary>>["handle"],
  photoId: string,
) {
  const result = await database.query<{ kind: string }>(
    `SELECT node.kind FROM photo_documents AS document
     JOIN document_revision_roots AS root
       ON root.photo_id = document.photo_id AND root.revision_id = document.active_revision_id
      AND root.root_name = 'output'
     JOIN image_nodes AS node ON node.photo_id = root.photo_id AND node.id = root.node_id
     WHERE document.photo_id = $1`,
    [photoId],
  );
  return result.rows[0]!.kind;
}
