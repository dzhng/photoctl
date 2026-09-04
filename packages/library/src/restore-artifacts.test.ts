import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createBackup } from "./backup.js";
import { initializeLibrary, openLibrary } from "./open.js";
import { restoreLibrary } from "./restore.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("restore replaces database state while preserving canonical artifacts and library-owned sources", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-restore-artifacts-"));
  directories.push(parent);
  const library = join(parent, "library");
  const initialized = await initializeLibrary(library);
  const artifact = join(library, "artifacts", "sha256", "ab", `a_${"ab".repeat(32)}.tif`);
  const original = join(library, "originals", "undated", "frame.ARW");
  const preview = join(library, "previews", "kept.jpg");
  await mkdir(join(library, "artifacts", "sha256", "ab"), { recursive: true });
  await mkdir(join(library, "originals", "undated"), { recursive: true });
  await mkdir(join(library, "previews"), { recursive: true });
  await writeFile(artifact, "canonical pixels stay byte-identical");
  await writeFile(original, "owned source stays byte-identical");
  await writeFile(preview, "local preview stays byte-identical");
  const backup = (await createBackup(initialized.handle)).path;
  await initialized.handle.query("DELETE FROM settings WHERE key = 'library_id'");
  await initialized.handle.close();

  await restoreLibrary(library, backup);

  expect(await readFile(artifact, "utf8")).toBe("canonical pixels stay byte-identical");
  expect(await readFile(original, "utf8")).toBe("owned source stays byte-identical");
  expect(await readFile(preview, "utf8")).toBe("local preview stays byte-identical");
  const restored = await openLibrary(library);
  await restored.close();
}, 20_000);
