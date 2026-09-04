import { afterEach, expect, test } from "vitest";
import { initializeLibrary, type LibraryHandle } from "@photoctl/library";
import { withLibrary } from "@photoctl/test-harness";
import { dispatch } from "./dispatch.js";
import { join } from "node:path";
import { doctorDataSchema } from "@photoctl/protocol";

let handle: LibraryHandle | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

test("doctor reports fixed and library-overridden provider ids without exposing credentials", async () => {
  await withLibrary(async (directory) => {
    const initialized = await initializeLibrary(join(directory, "library"));
    handle = initialized.handle;
    await handle.query(
      `INSERT INTO settings (key, value) VALUES
         ('models', '{"structured":"company/vision-v1","upscale":"photoctl/fake-upscale-v1"}'::jsonb),
         ('providers', '{"upscale":{"photoctl/fake-upscale-v1":{"configured":true}}}'::jsonb)`,
    );

    const result = await dispatch(
      {
        verb: "doctor",
        args: [],
        cwd: directory,
        env: { noDaemon: true, gatewayApiKey: "secret-key" },
      },
      { version: "test", library: handle },
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        providers: {
          gateway: {
            configured: true,
            models: {
              edit: "openai/gpt-image-2",
              structured: "company/vision-v1",
              embed: "google/gemini-embedding-2",
            },
          },
          upscale: {
            selected: "photoctl/fake-upscale-v1",
            configured: true,
          },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret-key");
    if (result.ok && "data" in result)
      expect(() => doctorDataSchema.parse(result.data)).not.toThrow();
  });
});
