import { initializeLibrary } from "@photoctl/library";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { doctorDataSchema } from "@photoctl/protocol";
import { dispatch } from "./dispatch.js";

test("public settings persists a model mirror consumed by doctor and restores its default", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-settings-"));
  const libraryPath = join(parent, "library");
  const { handle } = await initializeLibrary(libraryPath);
  const request = (verb: string, args: string[]) =>
    dispatch(
      { verb, args, cwd: parent, env: { noDaemon: true, libraryPath } },
      { version: "1.2.3", library: handle },
    );
  try {
    const mirror = "https://models.example.test/pinned/";
    const defaultUrl = doctorDataSchema.parse((await request("doctor", [])).data).models.base_url;
    expect(defaultUrl).not.toBe(mirror);
    expect(
      await request("settings", ["set", "models_base_url", JSON.stringify(mirror)]),
    ).toMatchObject({ ok: true, data: { settings: { models_base_url: mirror } } });
    expect(await request("doctor", [])).toMatchObject({
      ok: true,
      data: { models: { base_url: mirror } },
    });
    expect(await request("settings", ["get", "models_base_url"])).toMatchObject({
      ok: true,
      data: { settings: { models_base_url: mirror } },
    });
    expect(await request("settings", ["reset", "models_base_url"])).toMatchObject({
      ok: true,
      data: { settings: { models_base_url: null } },
    });
    expect(await request("doctor", [])).toMatchObject({
      ok: true,
      data: { models: { base_url: defaultUrl } },
    });
  } finally {
    await handle.close();
    await rm(parent, { recursive: true });
  }
});

test("invalid settings preserve prior values and cannot expose internal keys or credentials", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-settings-"));
  const libraryPath = join(parent, "library");
  const { handle } = await initializeLibrary(libraryPath);
  const request = (args: string[]) =>
    dispatch(
      { verb: "settings", args, cwd: parent, env: { noDaemon: true, libraryPath } },
      { version: "1.2.3", library: handle },
    );
  try {
    expect(await request(["set", "models", '{"edit":"test/retained"}'])).toMatchObject({
      ok: true,
    });
    const before = await request(["get"]);
    const originalId = await handle.query("SELECT value FROM settings WHERE key = 'library_id'");
    for (const args of [
      ["set", "models", '{"edit":"test/replaced","typo":"test/ignored"}'],
      ["set", "models", '{"edit":"auto"}'],
      ["set", "models", '{"edit":"vendor/latest"}'],
      ["set", "generation", '{"upscale":"off","unknown":true}'],
      ["set", "providers", '{"upscale":{"test/model":{"configured":true,"api_key":"secret"}}}'],
      ["set", "providers", '{"upscale":{"test/model":{"configured":"yes"}}}'],
      ["set", "models_base_url", '"https://user:secret@example.test/"'],
      ["set", "models_base_url", '"file:///tmp/models"'],
      ["set", "models_base_url", '"not a url"'],
      ["set", "cache_max_bytes", "0"],
      ["set", "cache_max_bytes", "1.5"],
      ["set", "embed_mode", '"always"'],
      ["set", "models", "not-json"],
      ["set", "library_id", '"changed"'],
      ["get", "library_id"],
      ["reset", "daemon_idle_ms"],
      ["set", "models.edit", '"test/model"'],
      ["set", "models"],
      ["get", "models", "extra"],
      ["reset"],
      ["get", "--typo"],
    ]) {
      const rejected = await request(args);
      expect(rejected, args.join(" ")).toMatchObject({ ok: false, code: "usage" });
      expect(JSON.stringify(rejected)).not.toContain("secret");
      expect(await request(["get"])).toEqual(before);
    }
    expect(await handle.query("SELECT value FROM settings WHERE key = 'library_id'")).toEqual(
      originalId,
    );
    expect(Object.keys((before.data as { settings: object }).settings)).not.toContain("library_id");
  } finally {
    await handle.close();
    await rm(parent, { recursive: true });
  }
});

test("public settings replaces whole objects and restores existing user defaults", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-settings-"));
  const libraryPath = join(parent, "library");
  const { handle } = await initializeLibrary(libraryPath);
  const request = (args: string[]) =>
    dispatch(
      { verb: "settings", args, cwd: parent, env: { noDaemon: true, libraryPath } },
      { version: "1.2.3", library: handle },
    );
  try {
    const defaults = await request(["get"]);
    expect(
      await request(["set", "models", JSON.stringify({ edit: "test/edit", embed: "test/embed" })]),
    ).toMatchObject({
      ok: true,
      data: { settings: { models: { edit: "test/edit", embed: "test/embed" } } },
    });
    expect(
      await request(["set", "models", JSON.stringify({ generate: "test/generate" })]),
    ).toMatchObject({ ok: true, data: { settings: { models: { generate: "test/generate" } } } });
    expect((await request(["get", "models"])).data).toEqual({
      settings: { models: { generate: "test/generate" } },
    });
    const changes = {
      generation: { upscale: "off" },
      providers: { upscale: { "test/upscale": { configured: true } } },
      embed_mode: "auto",
      cache_max_bytes: 123456,
    };
    for (const [key, value] of Object.entries(changes)) {
      expect(await request(["set", key, JSON.stringify(value)])).toMatchObject({
        ok: true,
        data: { settings: { [key]: value } },
      });
      expect((await request(["get", key])).data).toEqual({ settings: { [key]: value } });
    }
    for (const key of ["models", ...Object.keys(changes)])
      expect(await request(["reset", key])).toMatchObject({ ok: true });
    expect(await request(["get"])).toEqual(defaults);
    expect((await request(["get", "embed_mode"])).data).toEqual({
      settings: { embed_mode: "manual" },
    });
  } finally {
    await handle.close();
    await rm(parent, { recursive: true });
  }
});
