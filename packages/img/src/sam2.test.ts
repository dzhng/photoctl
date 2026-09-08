import { expect, test } from "vitest";
import { createSam2OnnxRuntime, sam2MaskFromLogits } from "./index.js";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { spawnSync } from "node:child_process";

const field = (tag: number, bytes: number[]) => [tag, bytes.length, ...bytes];

const identityOnnx = Uint8Array.from([
  0x08, 0x0a, 0x12, 0x0c, 0x62, 0x61, 0x63, 0x6b, 0x65, 0x6e, 0x64, 0x2d, 0x74, 0x65, 0x73, 0x74,
  0x3a, 0x5b, 0x0a, 0x10, 0x0a, 0x01, 0x78, 0x12, 0x01, 0x79, 0x22, 0x08, 0x49, 0x64, 0x65, 0x6e,
  0x74, 0x69, 0x74, 0x79, 0x12, 0x0d, 0x74, 0x65, 0x73, 0x74, 0x5f, 0x69, 0x64, 0x65, 0x6e, 0x74,
  0x69, 0x74, 0x79, 0x5a, 0x1b, 0x0a, 0x01, 0x78, 0x12, 0x16, 0x0a, 0x14, 0x08, 0x01, 0x12, 0x10,
  0x0a, 0x02, 0x08, 0x01, 0x0a, 0x02, 0x08, 0x01, 0x0a, 0x02, 0x08, 0x02, 0x0a, 0x02, 0x08, 0x02,
  0x62, 0x1b, 0x0a, 0x01, 0x79, 0x12, 0x16, 0x0a, 0x14, 0x08, 0x01, 0x12, 0x10, 0x0a, 0x02, 0x08,
  0x01, 0x0a, 0x02, 0x08, 0x01, 0x0a, 0x02, 0x08, 0x02, 0x0a, 0x02, 0x08, 0x02, 0x42, 0x04, 0x0a,
  0x00, 0x10, 0x15,
]);

test("a process with a live SAM runtime exits cleanly after inference", () => {
  const script = `
    import { createSam2OnnxRuntime } from '@photoctl/img';
    const model = Uint8Array.from(${JSON.stringify(Array.from(identityOnnx))});
    globalThis.runtime = createSam2OnnxRuntime(model, model);
    const [output] = await globalThis.runtime.runEncoder([
      { name: 'x', dimensions: [1, 1, 2, 2], f32Data: new Float32Array([1, 2, 3, 4]) }
    ], ['y']);
    console.log(JSON.stringify(Array.from(output.data)));
  `;
  // Exercise natural Node teardown, not only inference inside a live test runner.
  for (let attempt = 0; attempt < 16; attempt++) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("[1,2,3,4]");
  }
}, 30_000);

test("initialization warnings survive a later decoder construction failure", () => {
  // Add an unused float initializer to the identity graph; ORT reports its removal.
  const initializer = [
    0x2a,
    18,
    8,
    1,
    16,
    1,
    34,
    4,
    0,
    0,
    128,
    63,
    66,
    6,
    ...Buffer.from("unused"),
  ];
  const warningOnnx = Uint8Array.from([
    ...identityOnnx.slice(0, 17),
    91 + initializer.length,
    ...identityOnnx.slice(18, 109),
    ...initializer,
    ...identityOnnx.slice(109),
  ]);
  const diagnostics: Array<{ message: string }> = [];
  expect(() =>
    createSam2OnnxRuntime(warningOnnx, Buffer.from("invalid"), (batch) => {
      diagnostics.push(...batch.diagnostics);
    }),
  ).toThrow("invalid SAM decoder");
  expect(
    diagnostics.some(
      ({ message }) => message.includes("unused") && message.includes("Removing initializer"),
    ),
  ).toBe(true);
});

test("a live runtime does not retain the initialization request's diagnostic sink", async () => {
  const { runtime, weak } = (() => {
    const messages: string[] = [];
    const sink = (batch: import("./index.js").RuntimeDiagnostics) => {
      messages.push(...batch.diagnostics.map((diagnostic) => diagnostic.message));
    };
    return {
      runtime: createSam2OnnxRuntime(identityOnnx, identityOnnx, sink),
      weak: new WeakRef(sink),
    };
  })();
  setFlagsFromString("--expose-gc");
  const collect: () => void = runInNewContext("gc");
  await setImmediate();
  collect();
  expect(weak.deref()).toBeUndefined();
  expect(runtime.encoderInputNames()).toEqual(["x"]);
});

test("a failed inference leaves the session usable for queued requests", async () => {
  const runtime = createSam2OnnxRuntime(identityOnnx, identityOnnx);
  const input = (value: number) => [
    {
      name: "x",
      dimensions: [1, 1, 2, 2],
      f32Data: new Float32Array([value, 2, 3, 4]),
    },
  ];
  await expect(runtime.runEncoder(input(0), ["missing"])).rejects.toThrow("did not return missing");
  const outputs = await Promise.all(
    Array.from({ length: 8 }, (_, index) => runtime.runEncoder(input(index), ["y"])),
  );
  expect(outputs.map(([output]) => Array.from(output!.data))).toEqual(
    Array.from({ length: 8 }, (_, index) => [index, 2, 3, 4]),
  );
});

test("inference diagnostics accompany a failed operation without leaking into the next job", async () => {
  const text = (tag: number, value: string) => field(tag, [...Buffer.from(value)]);
  const tensorInfo = (name: string) => [
    ...text(10, name),
    ...field(
      18,
      field(10, [8, 1, ...field(18, [...field(10, text(18, "m")), ...field(10, text(18, "n"))])]),
    ),
  ];
  // Dynamic dimensions defer incompatible MatMul input shapes until inference.
  const node = [...text(10, "x"), ...text(10, "x"), ...text(18, "y"), ...text(34, "MatMul")];
  const graph = [
    ...field(10, node),
    ...text(18, "matmul"),
    ...field(90, tensorInfo("x")),
    ...field(98, tensorInfo("y")),
  ];
  const model = Uint8Array.from([8, 10, ...field(58, graph), ...field(66, [16, 21])]);
  const runtime = createSam2OnnxRuntime(model, identityOnnx);
  const messages: string[] = [];
  await expect(
    runtime.runEncoder(
      [{ name: "x", dimensions: [2, 3], f32Data: new Float32Array(6) }],
      ["y"],
      (batch) => messages.push(...batch.diagnostics.map((diagnostic) => diagnostic.message)),
    ),
  ).rejects.toThrow();
  expect(
    messages.some(
      (message) => message.includes("MatMul") && message.includes("dimension mismatch"),
    ),
  ).toBe(true);
  const next: string[] = [];
  expect(
    await runtime.runEncoder(
      [{ name: "x", dimensions: [2, 2], f32Data: new Float32Array([1, 0, 0, 1]) }],
      ["y"],
      (batch) => next.push(...batch.diagnostics.map((diagnostic) => diagnostic.message)),
    ),
  ).toEqual([{ dimensions: [2, 2], data: new Float32Array([1, 0, 0, 1]) }]);
  expect(next).toEqual([]);
});

test("the TypeScript seam supplies ONNX bytes to CPU sessions and maps logits", async () => {
  const runtime = createSam2OnnxRuntime(identityOnnx, identityOnnx);
  expect(runtime.encoderInputNames()).toEqual(["x"]);
  expect(runtime.decoderInputNames()).toEqual(["x"]);
  expect(
    await runtime.runDecoder(
      [{ name: "x", dimensions: [1, 1, 2, 2], f32Data: new Float32Array([1, 2, 3, 4]) }],
      ["y"],
    ),
  ).toEqual([{ dimensions: [1, 1, 2, 2], data: new Float32Array([1, 2, 3, 4]) }]);
  expect(
    sam2MaskFromLogits(new Float32Array([-1, 1, -0.25, 0.25]), 2, 2, {
      modelSize: 2,
      resizedWidth: 2,
      resizedHeight: 2,
      offsetX: 0,
      offsetY: 0,
      baseWidth: 2,
      baseHeight: 2,
    }),
  ).toEqual(new Float32Array([0, 1, 0, 1]));
});
