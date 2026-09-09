import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { doctorDataSchema, settingsDataSchema } from "@photoctl/protocol";

export function registerSettingsJourney(
  invoke: typeof spawnPhotoctl = spawnPhotoctl,
  title = "built CLI settings survive daemon restarts and reset the model mirror",
) {
  test(title, async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-settings-daemon-"));
    const libraryDir = join(directory, "library");
    const env = {
      PHOTOCTL_NO_DAEMON: "0",
      PHOTOCTL_CACHE: join(directory, "cache"),
      AI_GATEWAY_API_KEY: "",
    };
    const run = async (args: string[]) => {
      const result = await invoke(args, { libraryDir, env });
      expect(result.code, JSON.stringify(result.json)).toBe(0);
      return result.json;
    };
    try {
      await run(["init", "--path", libraryDir]);
      const defaultUrl = doctorDataSchema.parse((await run(["doctor"])).data).models.base_url;
      expect(defaultUrl).not.toBe("https://models.example.test/pinned/");
      await run(["settings", "set", "models", '{"edit":"test/persisted"}']);
      await run([
        "settings",
        "set",
        "models_base_url",
        JSON.stringify("https://models.example.test/pinned/"),
      ]);
      await run(["daemon", "stop"]);
      const selected = (await run(["settings", "get", "models"])).data;
      expect(settingsDataSchema.parse(selected)).toEqual({
        settings: { models: { edit: "test/persisted" } },
      });
      expect(await run(["doctor"])).toMatchObject({
        data: { models: { base_url: "https://models.example.test/pinned/" } },
      });
      await run(["settings", "reset", "models_base_url"]);
      expect(await run(["doctor"])).toMatchObject({
        data: {
          models: {
            base_url: defaultUrl,
          },
        },
      });
      await run(["daemon", "stop"]);
      expect(await run(["settings", "get", "models", "--no-daemon"])).toMatchObject({
        data: selected,
      });
    } finally {
      await invoke(["daemon", "stop"], { libraryDir, env });
      await rm(directory, { recursive: true });
    }
  }, 30_000);
}
