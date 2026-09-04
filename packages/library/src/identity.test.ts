import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { identifyFile, newLibraryEntityId } from "./identity.js";

test("the fixture identity matches the independent manifest", async () => {
  const identity = await identifyFile(
    fileURLToPath(new URL("../../../fixtures/a7c2.ARW", import.meta.url)),
  );

  expect(identity).toMatchObject({
    contentKey: "ck_3dac5c943a33dcc4",
    size: 73_400_320,
  });
});

test("changing only the end of a large file changes its identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-identity-"));
  const path = join(directory, "large.ARW");
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 64, 17);
  try {
    await writeFile(path, bytes);
    const before = await identifyFile(path);

    bytes.fill(29, bytes.length - 64);
    await writeFile(path, bytes);
    const after = await identifyFile(path);

    expect(after.contentKey).not.toBe(before.contentKey);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("a small file is hashed once after its little-endian size", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-identity-small-"));
  const path = join(directory, "small.jpg");
  try {
    await writeFile(path, "photoctl identity fixture\n");

    const identity = await identifyFile(path);

    expect(identity.contentKey).toBe("ck_7d31418a565fb99b");
    expect(identity.size).toBe(26);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("library entity IDs are UUIDv7 values", () => {
  const first = newLibraryEntityId();
  const second = newLibraryEntityId();

  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(second).not.toBe(first);
});
