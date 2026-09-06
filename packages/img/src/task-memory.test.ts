import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { resamplePixels, transformPixels, validateLinearArtifactSamples } from "./index.js";

function measureTaskMemory(mode: string, reject = false) {
  // Node 24's process.memoryUsage().external reports backing stores only. Its
  // trace-gc-verbose "External memory reported" reads the actual manual counter.
  // Test-only GC prints that counter at controlled phases, never an RSS verdict.
  const trace = execFileSync(
    process.execPath,
    [
      "--expose-gc",
      "--trace-gc-verbose",
      "--input-type=module",
      "-e",
      `
          import { writeSync } from "node:fs";
          import { developCameraFront, linearRec2020ToDisplaySrgb, resamplePixels, transformPixels, projectSupportedRgbPixels, compositeMaskedPixels, liftMaskedPixels, overlayMaskedPixels, validateLinearArtifactSamples } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
          const mode = ${JSON.stringify(mode)};
          const masked = ["composite", "lift", "overlay"].includes(mode);
          const mask = masked ? new Float32Array(262144).fill(0.25) : undefined;
          const projectionMatrix = [0.5,0,0,0.5,0,0];
          const convert = mode === "validation"
            ? data => validateLinearArtifactSamples(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), 0, data.byteLength)
            : mode === "lift"
            ? data => liftMaskedPixels(data, mask, 512, 512)
            : mode === "overlay"
            ? data => overlayMaskedPixels(data, data, mask, 512, 512, 0.5)
            : mode === "composite"
            ? data => compositeMaskedPixels(data, data, mask, 512, 512, 0.5)
            : mode === "projection"
            ? data => projectSupportedRgbPixels(data, 512, 512, [
                { width: 256, height: 256, matrix: [0.5,0,0,0.5,0,0] },
                { width: 128, height: 128, matrix: projectionMatrix },
              ], [])
            : mode === "resample"
            ? data => resamplePixels(data, 512, 512, 3, 256, 256, "bilinear")
            : mode === "transform"
            ? data => transformPixels(data, 512, 512, 3, 256, 256, [0.5,0,0,0.5,0,0], "bilinear")
            : mode === "display"
            ? linearRec2020ToDisplaySrgb
            : async data => (await developCameraFront({
                width: data.length / 3, height: 1, space: "camera", data,
                whiteLevel: 1, blackLevel: 0,
                camXyz: [1,0,0,0,1,0,0,0,1], asShotWb: [1,1,1], wbPreApplied: true,
              })).data;
          const warm = await convert(new Float32Array(masked || ["resample", "transform", "projection"].includes(mode) ? 3 * 262144 : 3).fill(0.25));
          if (${reject} && mode === "projection") projectionMatrix.fill(0);
          const input = new Float32Array(3 * 262144 + (${reject} && mode !== "projection" ? 256 : 0)).fill(0.25);
          if (${reject} && mode === "validation") input[0] = NaN;
          const checkpoint = name => {
            writeSync(1, "PHASE " + name + "\\n");
            global.gc(); global.gc();
          };
          const errors = [];
          const errorCodes = [];
          let output;
          checkpoint("before");
          if (${reject}) {
            for (let attempt = 0; attempt < 4; attempt++) {
              try { output = await convert(input); }
              catch (error) { errors.push(error.message); errorCodes.push(error.code); }
            }
          } else {
            const pending = convert(input);
            checkpoint("queued");
            output = await pending;
          }
          checkpoint("settled");
          writeSync(1, "RESULT " + JSON.stringify({ bytes: input.byteLength, outputBytes: output?.byteLength, sample: output?.[0], warm: warm?.[0], errors, errorCodes }) + "\\n");
        `,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  const measurements = Object.fromEntries(
    [...trace.matchAll(/PHASE (\w+)\n([\s\S]*?)(?=PHASE |RESULT )/g)].map((match) => {
      const report = [...match[2].matchAll(/External memory reported:\s+(\d+) KB/g)].at(-1);
      if (!report) throw new Error(`Missing V8 accounting diagnostic for ${match[1]}`);
      return [match[1], Number(report[1])];
    }),
  );
  for (const phase of reject ? ["before", "settled"] : ["before", "queued", "settled"]) {
    if (!(phase in measurements)) throw new Error(`Missing accounting phase ${phase}`);
  }
  const result = trace.match(/RESULT (.+)/);
  if (!result) throw new Error("Missing native task result");
  return { ...measurements, ...JSON.parse(result[1]) };
}

test.each(["camera", "display"])("%s pending color work reports its native snapshot", (mode) => {
  const result = measureTaskMemory(mode);
  expect(result.queued - result.before).toBe(result.bytes / 1024);
});

test("pending artifact validation reports its native byte snapshot", () => {
  const result = measureTaskMemory("validation");
  expect(result.queued - result.before).toBe(result.bytes / 1024);
});

test("successful artifact validation releases its snapshot without creating an output buffer", () => {
  const result = measureTaskMemory("validation");
  expect(result.outputBytes).toBeUndefined();
  expect(result.settled).toBe(result.before);
});

test("rejected artifact validation releases every snapshot charge", () => {
  const result = measureTaskMemory("validation", true);
  expect(result.errorCodes).toEqual(Array(4).fill("InvalidArg"));
  expect(result.errors).toEqual(Array(4).fill("linear artifact contains a non-finite sample"));
  expect(result.outputBytes).toBeUndefined();
  expect(result.settled).toBe(result.before);
});

test("artifact validation leaves input unchanged and rejects corrupt samples after a header", async () => {
  const bytes = Buffer.alloc(16, 0xff);
  for (let offset = 4; offset < 16; offset += 4) bytes.writeFloatLE(0.25, offset);
  const original = Buffer.from(bytes);
  await expect(validateLinearArtifactSamples(bytes, 4, 12)).resolves.toBeUndefined();
  expect(bytes).toEqual(original);
  bytes.writeFloatLE(NaN, 4);
  await expect(validateLinearArtifactSamples(bytes, 4, 12)).rejects.toThrow(
    "linear artifact contains a non-finite sample",
  );
  original.copy(bytes);
  await expect(validateLinearArtifactSamples(bytes, 4, 12)).resolves.toBeUndefined();
  expect(bytes).toEqual(original);
});

test.each(["camera", "display"])(
  "%s output replaces its task charge with Node backing-store accounting",
  (mode) => {
    const result = measureTaskMemory(mode);
    expect(result.settled - result.before).toBe(result.bytes / 1024);
  },
);

test.each(["camera", "display"])(
  "%s rejected work does not accumulate allocation charges",
  (mode) => {
    const result = measureTaskMemory(mode, true);
    expect(result.errorCodes).toEqual(Array(4).fill("InvalidArg"));
    expect(result.errors).toEqual(Array(4).fill(expect.stringContaining("RGB samples")));
    expect(result.outputBytes).toBeUndefined();
    expect(result.settled).toBe(result.before);
  },
);

test("resample pending work reports its native input snapshot", () => {
  const result = measureTaskMemory("resample");
  expect(result.queued - result.before).toBe(result.bytes / 1024);
});

test.each(["composite", "lift", "overlay"])(
  "%s pending work reports its RGB snapshots and mask capacity",
  (mode) => {
    const result = measureTaskMemory(mode);
    expect(result.queued - result.before).toBe(
      (result.bytes * (mode === "lift" ? 4 : 7)) / 3 / 1024,
    );
  },
);

test.each(["composite", "lift", "overlay"])(
  "%s settles with only its output backing store charged",
  (mode) => {
    const result = measureTaskMemory(mode);
    expect(result.sample).toBe(0.25);
    expect(result.outputBytes).toBe(result.bytes);
    expect(result.settled - result.before).toBe(result.bytes / 1024);
  },
);

test.each(["composite", "lift", "overlay"])(
  "invalid %s requests leave no native snapshot charge",
  (mode) => {
    const result = measureTaskMemory(mode, true);
    expect(result.errors).toEqual(Array(4).fill("RGB data does not match the mask dimensions"));
    expect(result.settled).toBe(result.before);
  },
);

test("transform pending work reports its native input snapshot", () => {
  const result = measureTaskMemory("transform");
  expect(result.queued - result.before).toBe(result.bytes / 1024);
});

test("supported projection accounts its two owned stage buffers and transfers only final pixels", () => {
  const result = measureTaskMemory("projection");
  expect(result.queued - result.before).toBe(((512 * 512 + 256 * 256) * 3 * 4) / 1024);
  expect(result.outputBytes).toBe(128 * 128 * 3 * 4);
  expect(result.settled - result.before).toBe(result.outputBytes / 1024);
});

test("supported projection rejection after an intermediate stage releases both charges", () => {
  const result = measureTaskMemory("projection", true);
  expect(result.errors).toEqual(Array(4).fill("transform matrix must be invertible"));
  expect(result.settled).toBe(result.before);
});

test.each(["resample", "transform"])("%s settles with only its distinct output charged", (mode) => {
  const result = measureTaskMemory(mode);
  expect(result.outputBytes).toBe(256 * 256 * 3 * Float32Array.BYTES_PER_ELEMENT);
  expect(result.sample).toBe(0.25);
  expect(result.settled - result.before).toBe(result.outputBytes / 1024);
});

test.each(["resample", "transform"])("%s rejection releases every input charge", (mode) => {
  const result = measureTaskMemory(mode, true);
  expect(result.errors).toEqual(Array(4).fill("pixel buffer length does not match its dimensions"));
  expect(result.settled).toBe(result.before);
});

test.each(["resample", "transform"])(
  "%s uses an immutable invocation snapshot with exact pixels",
  async (mode) => {
    const input = Float32Array.from({ length: 16 }, (_, index) => index);
    const original = input.slice();
    const pending =
      mode === "resample"
        ? resamplePixels(input, 4, 4, 1, 2, 2, "bilinear")
        : transformPixels(input, 4, 4, 1, 2, 2, [0.5, 0, 0, 0.5, 0, 0], "bilinear");
    expect(input).toEqual(original);
    input.fill(99);
    expect(await pending).toEqual(new Float32Array([2.5, 4.5, 10.5, 12.5]));
    expect(input).toEqual(new Float32Array(16).fill(99));
  },
);
