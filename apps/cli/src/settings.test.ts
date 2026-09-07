import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { registerSettingsJourney } from "../../../test/journeys/settings.js";

test("settings help works without a library and explains whole-key JSON replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-settings-help-"));
  try {
    const result = await spawnPhotoctl(["settings", "--help"], {
      cwd: directory,
      libraryDir: join(directory, "missing"),
    });
    expect(result.code).toBe(0);
    expect(result.json).toMatchObject({
      ok: true,
      data: {
        usage: expect.stringContaining("<json>"),
        description: expect.stringContaining("whole"),
      },
    });
    expect(JSON.stringify(result.json)).toContain("models_base_url");
  } finally {
    await rm(directory, { recursive: true });
  }
});

registerSettingsJourney();
