import { initializeLibrary, PINNED_MODEL_RELEASE } from "@photoctl/library";
import { doctorDataSchema } from "@photoctl/protocol";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test("doctor reports the ready SAM manifest and fetch refuses without a base URL", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-model-doctor-"));
  const libraryPath = join(parent, "library");
  const initialized = await initializeLibrary(libraryPath);
  try {
    const setting = await initialized.handle.query<{ value: unknown }>(
      "SELECT value FROM settings WHERE key = 'models_base_url'",
    );
    expect(setting.rows).toEqual([{ value: null }]);
    const context = { version: "test", library: initialized.handle };
    const env = { noDaemon: true, libraryPath };
    const reported = await dispatch({ verb: "doctor", args: [], cwd: parent, env }, context);
    expect(reported).toMatchObject({
      ok: true,
      data: {
        models: {
          base_url: null,
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

    const fetched = await dispatch(
      { verb: "doctor", args: ["--fetch-models"], cwd: parent, env },
      context,
    );
    expect(fetched).toMatchObject({
      ok: false,
      code: "provider_unconfigured",
      data: { reason: "models_base_url_missing" },
    });
  } finally {
    await initialized.handle.close();
    await rm(parent, { recursive: true });
  }
});
