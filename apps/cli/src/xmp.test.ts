import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { xmpResultSchema } from "@photoctl/protocol";
import { afterEach, expect, test } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("the built CLI exposes explicit xmp write and its typed batch result", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-cli-xmp-"));
  directories.push(root);
  const drive = join(root, "drive");
  const library = join(root, "library");
  const image = join(drive, "frame.png");
  await mkdir(drive);
  await writeFile(
    image,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const env = {
    PHOTOCTL_CACHE: join(root, "cache"),
    PHOTOCTL_VOLUME_MAP: `${drive}=xmp-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const imported = await spawnPhotoctl(["import", image, "--link"], { libraryDir: library, env });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];

  const written = await spawnPhotoctl(["xmp", "write", id], { libraryDir: library, env });

  expect(written.code).toBe(0);
  if (!("results" in written.json) || !written.json.results)
    throw new Error("Missing batch results");
  expect(xmpResultSchema.parse(written.json.results[0])).toMatchObject({
    id,
    ok: true,
    action: "written",
  });
  expect(await readFile(join(drive, "frame.xmp"), "utf8")).toContain(`photoctl:flag="none"`);

  await chmod(drive, 0o555);
  try {
    const refused = await spawnPhotoctl(["xmp", "write", id], { libraryDir: library, env });
    expect(refused.code).toBe(69);
    expect(refused.json).toMatchObject({ ok: false, code: "volume_readonly" });
  } finally {
    await chmod(drive, 0o755);
  }
}, 30_000);
