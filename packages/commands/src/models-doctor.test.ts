import { initializeLibrary, PINNED_MODEL_RELEASE } from "@photoctl/library";
import { doctorDataSchema } from "@photoctl/protocol";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test("doctor defaults to this CLI release's models and honors an explicit mirror", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-model-doctor-"));
  const libraryPath = join(parent, "library");
  const initialized = await initializeLibrary(libraryPath);
  try {
    const setting = await initialized.handle.query<{ value: unknown }>(
      "SELECT value FROM settings WHERE key = 'models_base_url'",
    );
    expect(setting.rows).toEqual([{ value: null }]);
    const context = { version: "1.2.3", library: initialized.handle };
    const env = { noDaemon: true, libraryPath };
    const reported = await dispatch({ verb: "doctor", args: [], cwd: parent, env }, context);
    expect(reported).toMatchObject({
      ok: true,
      data: {
        models: {
          base_url: "https://github.com/dzhng/photoctl/releases/download/v1.2.3/",
          manifest_ready: true,
          directory: join(libraryPath, "models"),
          artifacts: PINNED_MODEL_RELEASE.artifacts.map(({ file, sha256, opset }) => ({
            file,
            sha256,
            opset,
            cached: false,
          })),
        },
      },
    });
    if (reported.ok && "data" in reported)
      expect(() => doctorDataSchema.parse(reported.data)).not.toThrow();

    await initialized.handle.query(
      "UPDATE settings SET value = $1::jsonb WHERE key = 'models_base_url'",
      [JSON.stringify("https://models.example.test/pinned/")],
    );
    const mirrored = await dispatch({ verb: "doctor", args: [], cwd: parent, env }, context);
    expect(mirrored).toMatchObject({
      ok: true,
      data: { models: { base_url: "https://models.example.test/pinned/" } },
    });
  } finally {
    await initialized.handle.close();
    await rm(parent, { recursive: true });
  }
});
