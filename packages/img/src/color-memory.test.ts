import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

function measureColorMemory(mode: string, reject = false) {
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
          import { developCameraFront, linearRec2020ToDisplaySrgb } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
          const convert = ${JSON.stringify(mode)} === "display"
            ? linearRec2020ToDisplaySrgb
            : async data => (await developCameraFront({
                width: data.length / 3, height: 1, space: "camera", data,
                whiteLevel: 1, blackLevel: 0,
                camXyz: [1,0,0,0,1,0,0,0,1], asShotWb: [1,1,1], wbPreApplied: true,
              })).data;
          const warm = await convert(new Float32Array([0.1, 0.2, 0.3]));
          const input = new Float32Array(3 * 262144 + (${reject} ? 256 : 0)).fill(0.25);
          const checkpoint = name => {
            writeSync(1, "PHASE " + name + "\\n");
            global.gc(); global.gc();
          };
          const errors = [];
          let output;
          checkpoint("before");
          if (${reject}) {
            for (let attempt = 0; attempt < 4; attempt++) {
              try { output = await convert(input); }
              catch (error) { errors.push(error.message); }
            }
          } else {
            const pending = convert(input);
            checkpoint("queued");
            output = await pending;
          }
          checkpoint("settled");
          writeSync(1, "RESULT " + JSON.stringify({ bytes: input.byteLength, sample: output?.[0], warm: warm[0], errors }) + "\\n");
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
  if (!result) throw new Error("Missing color conversion result");
  return { ...measurements, ...JSON.parse(result[1]) };
}

test.each(["camera", "display"])("%s pending color work reports its native snapshot", (mode) => {
  const result = measureColorMemory(mode);
  expect(result.queued - result.before).toBe(result.bytes / 1024);
});

test.each(["camera", "display"])(
  "%s output replaces its task charge with Node backing-store accounting",
  (mode) => {
    const result = measureColorMemory(mode);
    expect(result.settled - result.before).toBe(result.bytes / 1024);
  },
);

test.each(["camera", "display"])(
  "%s rejected work does not accumulate allocation charges",
  (mode) => {
    const result = measureColorMemory(mode, true);
    expect(result.errors).toEqual(
      Array(4).fill(
        mode === "camera"
          ? "camera front expects RGB samples, a 3x3 matrix, and three WB gains"
          : "display conversion expects interleaved RGB samples",
      ),
    );
    expect(result.settled).toBe(result.before);
  },
);
