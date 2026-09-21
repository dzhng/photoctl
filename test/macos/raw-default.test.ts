import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { showDataSchema } from "@photoctl/protocol";

// Real helper coverage complements the portable helper-wire orchestration tests.
test("the default RAW preview decodes the original with CIRAW reconstruction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-raw-default-"));
  const library = join(directory, "library");
  const repository = resolve(import.meta.dirname, "../..");
  const env = {
    PHOTOCTL_NO_DAEMON: "1",
    PHOTOCTL_CACHE: join(directory, "cache"),
    PHOTOCTL_VOLUME_MAP: `${repository}=camera:online`,
    PHOTOCTL_MAC_HELPER_PATH: join(repository, "helpers/mac/.build/debug/photoctl-mac"),
  };
  try {
    expect((await spawnPhotoctl(["init", "--path", library], { env })).code).toBe(0);
    const imported = await spawnPhotoctl(
      [
        "import",
        join(repository, "fixtures/camera/highlights/DSC00229.ARW"),
        "--link",
        "--companions",
        "raw",
      ],
      { env, libraryDir: library },
    );
    expect(imported.code).toBe(0);
    const id = (imported.json as { data: { ids: string[] } }).data.ids[0];
    const shown = await spawnPhotoctl(["show", id], { env, libraryDir: library });
    expect(shown.code, JSON.stringify(shown.json)).toBe(0);
    const data = showDataSchema.parse((shown.json as { data: unknown }).data);
    expect(data.preview_info.source_treatment).toMatchObject({
      decoderId: "ciraw",
      requested: "reconstruct",
      status: "applied",
      scale: 1,
    });
    expect(data.preview_info).toMatchObject({
      source_tier: "online-file",
      source_dimensions: { w: 4672, h: 7008 },
      actual: { w: 1077, h: 1616 },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
