import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { spawnPhotoctl } from "./spawn.js";

test("CLI tests ignore ambient and saved credentials unless explicitly supplied", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-driver-credentials-"));
  let requests = 0;
  const gateway = createServer((request, response) => {
    requests += 1;
    request.resume();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ embedding: Array(3072).fill(0.25) }] }));
  });
  try {
    await mkdir(join(directory, ".openphoto"));
    await writeFile(join(directory, ".openphoto", ".env"), "AI_GATEWAY_API_KEY=saved-fixture\n");
    await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    const address = gateway.address();
    if (!address || typeof address === "string") throw new Error("missing fixture address");
    const options = {
      libraryDir: join(directory, "library"),
      env: {
        HOME: directory,
        PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
      },
    };
    expect(await spawnPhotoctl(["init"], options)).toMatchObject({ code: 0 });
    for (const ambient of [undefined, "ambient-fixture"]) {
      vi.stubEnv("AI_GATEWAY_API_KEY", ambient);
      const result = await spawnPhotoctl(["search", "needle"], options);
      expect(requests).toBe(0);
      expect(result).toMatchObject({
        code: 0,
        json: { ok: true, warnings: [expect.objectContaining({ code: "provider_unconfigured" })] },
      });
    }
    expect(
      await spawnPhotoctl(["search", "needle"], {
        ...options,
        env: { ...options.env, AI_GATEWAY_API_KEY: "explicit-fixture" },
      }),
    ).toMatchObject({ code: 0, json: { ok: true, warnings: [] } });
    expect(requests).toBe(1);
  } finally {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("the CLI driver invokes a selected installed executable from an independent cwd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-driver-"));
  const cliPath = join(directory, "cli.mjs");
  try {
    await writeFile(
      cliPath,
      "console.log(JSON.stringify({schema:1,ok:true,data:{cwd:process.cwd(),args:process.argv.slice(2)},warnings:[]}));",
    );
    const result = await spawnPhotoctl(["probe-installed"], { cliPath, cwd: directory });
    expect(result).toMatchObject({
      code: 0,
      json: {
        ok: true,
        data: { cwd: await realpath(directory), args: ["probe-installed"] },
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
