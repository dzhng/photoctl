import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { expect, test } from "vitest";
import { startGatewayFixture } from "@photoctl/test-harness";

const run = promisify(execFile);

test("a targeted auto-enhance check does not repeat unrelated paid operations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openphoto-live-targeted-"));
  const requests: string[] = [];
  const gateway = await startGatewayFixture(0, {
    structuredResponse: { exposure: 0.25 },
    onRequest: ({ path }) => requests.push(path),
  });
  try {
    const address = gateway.address();
    if (!address || typeof address === "string") throw new Error("No gateway address");
    const evidence = join(directory, "journey");
    await run(
      process.execPath,
      ["scripts/live-gateway.mjs", "--out", evidence, "--only", "auto-enhance"],
      {
        env: {
          ...process.env,
          OPENPHOTO_LIVE_API_KEY: "targeted-fixture",
          OPENPHOTO_LIVE_MODELS_DIRECTORY: "",
          OPENPHOTO_LIVE_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
        },
        timeout: 30_000,
      },
    );
    const report = JSON.parse(await readFile(join(evidence, "report.json"), "utf8"));
    expect(report).toMatchObject({ status: "passed", scope: "auto-enhance" });
    expect(report.stages.map((entry: { name: string }) => entry.name)).toEqual(["auto-enhance"]);
    expect(requests).toEqual(["/v1/chat/completions"]);
    await expect(access(join(evidence, "home", ".openphoto", ".env"))).rejects.toThrow();
  } finally {
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 35_000);

test("a targeted masked edit proves local fidelity and replays without another purchase", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openphoto-live-mask-"));
  const requests: string[] = [];
  const gateway = await startGatewayFixture(0, { onRequest: ({ path }) => requests.push(path) });
  try {
    const address = gateway.address();
    if (!address || typeof address === "string") throw new Error("No gateway address");
    const evidence = join(directory, "journey");
    const outcome = await run(
      process.execPath,
      ["scripts/live-gateway.mjs", "--out", evidence, "--only", "masked-edit"],
      {
        env: {
          ...process.env,
          OPENPHOTO_LIVE_API_KEY: "mask-fixture",
          OPENPHOTO_LIVE_MODELS_DIRECTORY: "",
          OPENPHOTO_LIVE_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
        },
        timeout: 40_000,
      },
    ).catch((error: { stdout: string; stderr: string }) => error);
    const report = JSON.parse(await readFile(join(evidence, "report.json"), "utf8"));
    expect(report.status, JSON.stringify(report.stages) + outcome.stderr).toBe("passed");
    const [masked] = report.stages;
    expect(masked.fidelity).toMatchObject({ changedOutsidePixels: 0 });
    expect(masked.fidelity.outsidePixels).toBe(1024 * 1024 - 256 * 256);
    expect(masked.fidelity.changedInsidePixels).toBeGreaterThan(0);
    expect(masked.replay.samePixels).toBe(true);
    expect(masked.replay.undoRevision).not.toBe(masked.replay.beforeRevision);
    expect(masked.replay.afterRevision).toBe(masked.replay.beforeRevision);
    expect(requests).toEqual(["/v1/images/edits"]);
    await expect(access(join(evidence, "home", ".openphoto", ".env"))).rejects.toThrow();
  } finally {
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 45_000);

test("interrupting a pending provider request removes its saved credential and records interruption", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openphoto-live-interrupt-"));
  let received!: () => void;
  const requested = new Promise<void>((resolve) => {
    received = resolve;
  });
  const gateway = createServer((request) => {
    request.resume();
    received();
  });
  let child: ReturnType<typeof execFile> | undefined;
  try {
    await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    const address = gateway.address();
    if (!address || typeof address === "string") throw new Error("No gateway address");
    const evidence = join(directory, "journey");
    const finished = new Promise<number | string | null>((resolve) => {
      child = execFile(
        process.execPath,
        ["scripts/live-gateway.mjs", "--out", evidence],
        {
          env: {
            ...process.env,
            OPENPHOTO_LIVE_API_KEY: "interrupt-fixture",
            OPENPHOTO_LIVE_MODELS_DIRECTORY: "",
            OPENPHOTO_LIVE_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
          },
          timeout: 30_000,
        },
        (error) => resolve(error?.code ?? 0),
      );
    });
    await requested;
    await access(join(evidence, "home", ".openphoto", ".env"));
    child!.kill("SIGTERM");
    await finished;
    await expect(access(join(evidence, "home", ".openphoto", ".env"))).rejects.toThrow();
    expect(JSON.parse(await readFile(join(evidence, "report.json"), "utf8"))).toMatchObject({
      status: "interrupted",
      reason: "SIGTERM",
    });
  } finally {
    child?.kill("SIGKILL");
    gateway.closeAllConnections();
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 35_000);

test("the live runner drives saved-key CLI providers and replays purchased pixels offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openphoto-live-test-"));
  const requests: string[] = [];
  const gateway = await startGatewayFixture(0, {
    structuredResponse: { exposure: 0.25 },
    onRequest: ({ path }) => requests.push(path),
  });
  try {
    const address = gateway.address();
    if (!address || typeof address === "string") throw new Error("No gateway address");
    const evidence = join(directory, "journey");
    const result = await run(process.execPath, ["scripts/live-gateway.mjs", "--out", evidence], {
      env: {
        ...process.env,
        AI_GATEWAY_API_KEY: "ambient-must-not-win",
        OPENPHOTO_LIVE_API_KEY: "explicit-live-fixture",
        OPENPHOTO_LIVE_MODELS_DIRECTORY: "",
        OPENPHOTO_LIVE_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
      },
      timeout: 90_000,
    })
      .then((completed) => ({ ...completed, code: 0 }))
      .catch((error: { stdout: string; stderr: string; code: number | string }) => error);
    expect(result.stdout + result.stderr).not.toMatch(
      /explicit-live-fixture|ambient-must-not-win/u,
    );
    const report = JSON.parse(await readFile(join(evidence, "report.json"), "utf8"));
    expect(
      report.status,
      JSON.stringify(
        report.stages.filter((entry: { status: string }) => entry.status !== "passed"),
      ),
    ).toBe("failed");
    expect(result.code).toBe(1);
    expect(
      report.stages
        .filter((entry: { status: string }) => entry.status === "failed")
        .map((entry: { name: string }) => entry.name),
    ).toContain("text-grounding");
    expect(report.stages).toContainEqual(expect.objectContaining({ name: "masked-edit" }));
    const replay = report.stages.find((entry: { name: string }) => entry.name === "offline-replay");
    expect(replay.undoRevision).not.toBe(replay.beforeRevision);
    expect(replay.afterRevision).toBe(replay.beforeRevision);
    expect(replay.purchaseIds).toEqual(expect.arrayContaining([expect.stringMatching(/^exec_/u)]));
    await access(join(evidence, "replay-cache"));
    await Promise.all(
      ["generated-preview", "reimagined-preview", "relit-preview"].map(async (name) => {
        const captured = report.stages.find((entry: { name: string }) => entry.name === name);
        await access(join(evidence, captured.file));
        expect(captured.executions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              execution_id: expect.stringMatching(/^exec_/u),
              provider_image_attempt_id: expect.any(String),
            }),
          ]),
        );
      }),
    );
    expect(report.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "image-embedding", status: "passed" }),
        expect.objectContaining({ name: "vector-search", status: "passed" }),
        expect.objectContaining({ name: "auto-enhance", status: "passed" }),
        expect.objectContaining({ name: "generate", status: "passed" }),
        expect.objectContaining({ name: "reimagine", status: "passed" }),
        expect.objectContaining({ name: "relight", status: "passed" }),
        expect.objectContaining({ name: "offline-replay", status: "passed", samePixels: true }),
      ]),
    );
    const reportedEdits = report.stages
      .filter((entry: { name: string }) =>
        ["reimagine", "relight", "masked-edit"].includes(entry.name),
      )
      .flatMap(
        (entry: { data?: { executions?: Array<{ kind: string }> } }) =>
          entry.data?.executions ?? [],
      )
      .filter((execution: { kind: string }) => execution.kind === "generate");
    expect(requests.filter((path) => path === "/v1/images/edits")).toHaveLength(
      reportedEdits.length,
    );
    expect(requests.filter((path) => path === "/v1/images/generations")).toHaveLength(1);
    await expect(access(join(evidence, "home", ".openphoto", ".env"))).rejects.toThrow();
  } finally {
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 95_000);

test("a provider failure stays visible and the live credential is removed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openphoto-live-test-"));
  const secret = 'fixture-"quoted\\key';
  const gateway = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "x-request-id": secret }).end("invalid JSON");
  });
  try {
    await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    const address = gateway.address();
    if (!address || typeof address === "string") throw new Error("No gateway address");
    const evidence = join(directory, "journey");
    const result = await run(process.execPath, ["scripts/live-gateway.mjs", "--out", evidence], {
      env: {
        ...process.env,
        OPENPHOTO_LIVE_API_KEY: secret,
        OPENPHOTO_LIVE_MODELS_DIRECTORY: "",
        OPENPHOTO_LIVE_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
      },
      timeout: 60_000,
    })
      .then(() => ({ code: 0 }))
      .catch((error: { code: number | string }) => error);
    expect(result.code).toBe(1);
    const report = JSON.parse(await readFile(join(evidence, "report.json"), "utf8"));
    expect(report.status).toBe("failed");
    expect(report.stages).toContainEqual(
      expect.objectContaining({
        name: "image-embedding",
        status: "failed",
        error: expect.objectContaining({ code: "provider_busy" }),
      }),
    );
    expect(JSON.stringify(report)).not.toContain(JSON.stringify(secret).slice(1, -1));
    expect(report.stages).not.toContainEqual(
      expect.objectContaining({ name: "offline-replay", status: "passed" }),
    );
    await expect(access(join(evidence, "home", ".openphoto", ".env"))).rejects.toThrow();
  } finally {
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 65_000);

test("the live CLI journey does not spend with only an ambient gateway key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openphoto-live-test-"));
  try {
    const evidence = join(directory, "journey");
    const result = await run(process.execPath, ["scripts/live-gateway.mjs", "--out", evidence], {
      env: {
        ...process.env,
        AI_GATEWAY_API_KEY: "ambient-must-not-spend",
        OPENPHOTO_LIVE_API_KEY: "",
      },
    });
    expect(result.stdout + result.stderr).not.toContain("ambient-must-not-spend");
    expect(JSON.parse(await readFile(join(evidence, "report.json"), "utf8"))).toMatchObject({
      status: "not_run",
      reason: "explicit_live_key_required",
      stages: [],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
