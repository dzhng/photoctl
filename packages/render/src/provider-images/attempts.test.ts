import { initializeLibrary } from "@photoctl/library";
import { GatewayClient, GatewayImageModelAdapter } from "@photoctl/providers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { prepareStandaloneGeneratedPhoto } from "../generate.js";

test("valid PNG headers with corrupt compressed pixels never create an original artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-attempt-invalid-pixels-"));
  const handle = (await initializeLibrary(join(directory, "library"))).handle;
  try {
    const original = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    original[original.indexOf("IDAT") + 4] ^= 255;
    expect(await sharp(original).metadata()).toMatchObject({ width: 4, height: 4 });
    const response = {
      data: { data: [{ b64_json: original.toString("base64") }] },
      requestId: "corrupt-pixels",
      attempts: 1,
    };
    const adapter = new GatewayImageModelAdapter({
      model: "fixture",
      mask: "native",
      maskPolarity: "unverified",
    });
    await expect(
      prepareStandaloneGeneratedPhoto(handle, handle.path, {
        dimensions: { w: 4, h: 4 },
        prompt: "red",
        promptVersion: 1,
        preparedRequest: {
          route: "generations",
          body: {},
          warnings: [],
          appliedControls: { reference: false, init: "original" },
        },
        dependencies: {
          model: "fixture",
          gateway: { imageGenerations: async () => response, imageEdits: async () => response },
          adapter,
        },
      }),
    ).rejects.toThrow();
    expect(
      (await handle.query("SELECT state, original_artifact_hash FROM provider_image_attempts"))
        .rows,
    ).toEqual([{ state: "failed", original_artifact_hash: null }]);
    expect((await handle.query("SELECT artifact_hash FROM image_artifacts")).rows).toEqual([]);
  } finally {
    await handle.close();
    await rm(directory, { recursive: true });
  }
});

test("a rate-limit retry followed by transport rejection records observed requests without an invented image", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-attempt-retries-"));
  const handle = (await initializeLibrary(join(directory, "library"))).handle;
  let calls = 0;
  try {
    const gateway = new GatewayClient({
      apiKey: "fixture",
      baseUrl: "https://unused.invalid",
      sleep: async () => {},
      fetch: async () => {
        calls += 1;
        return new Response("failed", {
          status: calls === 1 ? 429 : 503,
          headers: { "retry-after": "0" },
        });
      },
    });
    const adapter = new GatewayImageModelAdapter({
      model: "fixture",
      mask: "native",
      maskPolarity: "unverified",
    });
    await expect(
      prepareStandaloneGeneratedPhoto(handle, handle.path, {
        dimensions: { w: 4, h: 4 },
        prompt: "red",
        promptVersion: 1,
        preparedRequest: {
          route: "generations",
          body: {},
          warnings: [],
          appliedControls: { reference: false, init: "original" },
        },
        dependencies: { model: "fixture", gateway, adapter },
      }),
    ).rejects.toMatchObject({ code: "provider_busy", data: { attempt_id: expect.any(String) } });
    expect(calls).toBe(2);
    expect(
      (
        await handle.query(
          "SELECT state, original_artifact_hash, provenance FROM provider_image_attempts",
        )
      ).rows,
    ).toEqual([
      {
        state: "failed",
        original_artifact_hash: null,
        provenance: { schema: 1, transport_attempts: 2, request_id: null, cost_usd: null },
      },
    ]);
  } finally {
    await handle.close();
    await rm(directory, { recursive: true });
  }
});

test("working conversion failure keeps the valid original and records a failed attempt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-attempt-conversion-"));
  const handle = (await initializeLibrary(join(directory, "library"))).handle;
  try {
    const original = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const adapter = new GatewayImageModelAdapter({
      model: "fixture",
      mask: "native",
      maskPolarity: "unverified",
    });
    const response = {
      data: { data: [{ b64_json: original.toString("base64") }] },
      requestId: "fixture-conversion",
      attempts: 1,
    };
    await expect(
      prepareStandaloneGeneratedPhoto(handle, handle.path, {
        dimensions: { w: 4, h: 4 },
        prompt: "red",
        promptVersion: 1,
        preparedRequest: {
          route: "generations",
          body: {},
          warnings: [],
          appliedControls: { reference: false, init: "original" },
        },
        dependencies: {
          model: "fixture",
          gateway: { imageGenerations: async () => response, imageEdits: async () => response },
          adapter: {
            id: adapter.id,
            version: adapter.version,
            normalize: async (...args) => ({
              ...(await adapter.normalize(...args)),
              png: Buffer.from("broken working conversion"),
            }),
          },
        },
      }),
    ).rejects.toThrow();
    expect(
      (await handle.query("SELECT state, original_artifact_hash FROM provider_image_attempts"))
        .rows,
    ).toEqual([
      { state: "failed", original_artifact_hash: expect.stringMatching(/^a_[a-f0-9]{64}$/) },
    ]);
  } finally {
    await handle.close();
    await rm(directory, { recursive: true });
  }
});

test("an adapter that omits original capture cannot return a prepared paid success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-attempt-uncaptured-"));
  const handle = (await initializeLibrary(join(directory, "library"))).handle;
  try {
    const original = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const adapter = new GatewayImageModelAdapter({
      model: "fixture",
      mask: "native",
      maskPolarity: "unverified",
    });
    const response = {
      data: { data: [{ b64_json: original.toString("base64") }] },
      requestId: "fixture-uncaptured",
      attempts: 1,
    };
    await expect(
      prepareStandaloneGeneratedPhoto(handle, handle.path, {
        dimensions: { w: 4, h: 4 },
        prompt: "red",
        promptVersion: 1,
        preparedRequest: {
          route: "generations",
          body: {},
          warnings: [],
          appliedControls: { reference: false, init: "original" },
        },
        dependencies: {
          model: "fixture",
          gateway: { imageGenerations: async () => response, imageEdits: async () => response },
          adapter: {
            id: adapter.id,
            version: adapter.version,
            normalize: async (data, dimensions) => await adapter.normalize(data, dimensions),
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "provider_unconfigured",
      data: { attempt_id: expect.any(String), retention_failed: true },
    });
    expect(
      (await handle.query("SELECT state, original_artifact_hash FROM provider_image_attempts"))
        .rows,
    ).toEqual([{ state: "failed", original_artifact_hash: null }]);
    expect((await handle.query("SELECT artifact_hash FROM image_artifacts")).rows).toEqual([]);
  } finally {
    await handle.close();
    await rm(directory, { recursive: true });
  }
});

test("original registration failure stops normalization with a non-retryable retention diagnostic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-attempt-persistence-"));
  const handle = (await initializeLibrary(join(directory, "library"))).handle;
  try {
    await handle.query(
      "CREATE FUNCTION reject_original() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced artifact registration failure'; END $$",
    );
    await handle.query(
      "CREATE TRIGGER reject_original BEFORE INSERT ON image_artifacts FOR EACH ROW EXECUTE FUNCTION reject_original()",
    );
    const original = await sharp({
      create: { width: 5, height: 4, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const adapter = new GatewayImageModelAdapter({
      model: "fixture",
      mask: "native",
      maskPolarity: "unverified",
    });
    const response = {
      data: { data: [{ b64_json: original.toString("base64") }] },
      requestId: "fixture-registration",
      attempts: 1,
    };
    await expect(
      prepareStandaloneGeneratedPhoto(handle, handle.path, {
        dimensions: { w: 4, h: 4 },
        prompt: "red",
        promptVersion: 1,
        preparedRequest: {
          route: "generations",
          body: {},
          warnings: [],
          appliedControls: { reference: false, init: "original" },
        },
        dependencies: {
          model: "fixture",
          gateway: { imageGenerations: async () => response, imageEdits: async () => response },
          adapter,
        },
      }),
    ).rejects.toMatchObject({
      code: "catalog_unreadable",
      data: { attempt_id: expect.any(String), retention_failed: true },
    });
    expect(
      (
        await handle.query(
          "SELECT state, original_artifact_hash, outcome->>'message' AS message FROM provider_image_attempts",
        )
      ).rows,
    ).toEqual([
      {
        state: "failed",
        original_artifact_hash: null,
        message: expect.stringContaining("forced artifact registration failure"),
      },
    ]);
    expect((await handle.query("SELECT artifact_hash FROM image_artifacts")).rows).toEqual([]);
  } finally {
    await handle.close();
    await rm(directory, { recursive: true });
  }
});
