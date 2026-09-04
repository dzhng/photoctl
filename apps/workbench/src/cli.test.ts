import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runWorkbench } from "./run.js";
import { createBackup, initializeLibrary } from "@photoctl/library";
import { commitRevision, type NodeDraft } from "@photoctl/render";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("envelope writes a self-contained report of success, failure, and partial outcomes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-workbench-"));
  temporaryDirectories.push(cwd);

  const output = await runWorkbench(["envelope"], cwd);
  const html = await readFile(output, "utf8");

  expect(output).toBe(join(cwd, "out", "wb", "envelope.html"));
  expect(html).toContain("Successful show");
  expect(html).toContain("Library locked");
  expect(html).toContain("Partial export");
  expect(html).toContain("Exit 0");
  expect(html).toContain("Exit 75");
  expect(html).toContain("Exit 65");
  expect(html).toContain("&quot;code&quot;: &quot;library_locked&quot;");
  expect(html).toContain("&quot;code&quot;: &quot;partial&quot;");
  expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/u);
});

test("race renders observed contention and retry wording from the latest probe", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-workbench-race-"));
  temporaryDirectories.push(cwd);
  await import("node:fs/promises").then(async ({ mkdir, writeFile }) => {
    await mkdir(join(cwd, "out", "wb"), { recursive: true });
    await writeFile(
      join(cwd, "out", "wb", "race.json"),
      JSON.stringify({
        clients: 24,
        rowsPerClient: 25,
        expectedRows: 600,
        successfulWrites: 225,
        foundRows: 225,
        failures: { library_locked: 15 },
        clientsObserved: [{ client: 0, ok: 9, failed: 16, elapsedMs: 431 }],
      }),
    );
  });

  const output = await runWorkbench(["race"], cwd);
  const html = await readFile(output, "utf8");

  expect(output).toBe(join(cwd, "out", "wb", "race.html"));
  expect(html).toContain("225 / 225 accepted rows persisted");
  expect(html).toContain("Library busy — retry this command.");
  expect(html).toContain("library_locked");
  expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/u);
});

test("library renders current schema, row counts, backups, and indexed cache bytes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-workbench-library-"));
  temporaryDirectories.push(cwd);
  const library = join(cwd, "library");
  const initialized = await initializeLibrary(library);
  await initialized.handle.query(
    "INSERT INTO cache_index (path, bytes, last_used, pinned) VALUES ('emb/example.jpg', 42, now(), true)",
  );
  const backup = await createBackup(initialized.handle);
  await initialized.handle.close();

  const output = await runWorkbench(["library"], cwd, { PHOTOCTL_LIBRARY: library });
  const html = await readFile(output, "utf8");

  expect(output).toBe(join(cwd, "out", "wb", "library.html"));
  expect(html).toContain("Library ID</span>");
  expect(html).toContain("Library path</span>");
  expect(html).toContain('<th scope="col">Table</th><th scope="col">Rows</th>');
  expect(html).toContain("Schema version</span><strong>5</strong>");
  expect(html).toContain("Indexed cache</span><strong>42 B</strong>");
  expect(html).toContain("cache_index</td><td>1</td>");
  expect(html).toContain(backup.path.slice(backup.path.lastIndexOf("/") + 1));
  expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/u);
});

test("graph renders a source to develop to output structure with revision identities", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-workbench-graph-"));
  temporaryDirectories.push(cwd);
  const library = join(cwd, "library");
  const initialized = await initializeLibrary(library);
  const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c051";
  await initialized.handle.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_567890abcdef1234', 1, 1, 1, 1)`,
    [photoId],
  );
  const revision = await commitRevision(initialized.handle, {
    photoId,
    expectedRevisionId: null,
    nodes: [
      {
        localKey: "source",
        kind: "source",
        recipeVersion: 1,
        parameters: { orientation: 1 },
        inputs: [],
      },
      {
        localKey: "develop",
        kind: "develop",
        recipeVersion: 1,
        parameters: { exposure: 1 },
        inputs: [{ localKey: "source" }],
      },
      {
        localKey: "output",
        kind: "output",
        recipeVersion: 1,
        parameters: { format: "display-rgb", color_space: "srgb" },
        inputs: [{ localKey: "develop" }],
      },
    ],
    rootUpdates: [{ root: "output", node: { localKey: "output" } }],
  });
  await initialized.handle.close();

  const output = await runWorkbench(["graph", photoId], cwd, { PHOTOCTL_LIBRARY: library });
  const html = await readFile(output, "utf8");

  expect(output).toBe(join(cwd, "out", "wb", "graph.html"));
  expect(html).toContain("source");
  expect(html).toContain("develop");
  expect(html).toContain("output");
  expect(html.indexOf('class="node source"')).toBeLessThan(html.indexOf('class="node develop"'));
  expect(html.indexOf('class="node develop"')).toBeLessThan(html.indexOf('class="node output"'));
  expect(html).toContain(revision.revisionId);
  expect(html).toContain(revision.renderHash!);
  expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/u);
});

test("graph follows bounded inspection pages through the active output lineage", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-workbench-large-graph-"));
  temporaryDirectories.push(cwd);
  const library = join(cwd, "library");
  const initialized = await initializeLibrary(library);
  const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c052";
  await initialized.handle.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_67890abcdef12345', 1, 1, 1, 1)`,
    [photoId],
  );
  const nodes: NodeDraft[] = [
    {
      localKey: "source",
      kind: "source" as const,
      recipeVersion: 1,
      parameters: { orientation: 1 },
      inputs: [],
    },
  ];
  let previous = "source";
  for (let index = 0; index < 101; index += 1) {
    const localKey = `develop-${index}`;
    nodes.push({
      localKey,
      kind: "develop" as const,
      recipeVersion: 1,
      parameters: { step: index },
      inputs: [{ localKey: previous }],
    });
    previous = localKey;
  }
  nodes.push({
    localKey: "output",
    kind: "output" as const,
    recipeVersion: 1,
    parameters: { format: "display-rgb", color_space: "srgb" },
    inputs: [{ localKey: previous }],
  });
  await commitRevision(initialized.handle, {
    photoId,
    expectedRevisionId: null,
    nodes,
    rootUpdates: [{ root: "output", node: { localKey: "output" } }],
  });
  await initialized.handle.close();

  const output = await runWorkbench(["graph", photoId], cwd, { PHOTOCTL_LIBRARY: library });
  const html = await readFile(output, "utf8");

  expect(html.match(/<article class="node /gu)).toHaveLength(103);
  expect(html).toContain('class="node source"');
  expect(html).toContain('class="node output"');
});
