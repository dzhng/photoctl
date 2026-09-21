import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** External CIRAW wire fixture; synthetic pixels test orchestration, not camera quality. */
export async function rawTestHelper(
  directory: string,
  mode: "applied" | "unsupported" | "failure",
  [width, height]: [number, number] = [2, 1],
) {
  const path = join(directory, "ciraw-helper.mjs");
  await writeFile(
    path,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const mode = ${JSON.stringify(mode)};
if (args[0] === "--version") {
  console.log("photoctl-mac test");
} else if (args[0] === "probe") {
  console.log(JSON.stringify({supported:true,decoderVersion:"test",supportedDecoderVersions:["test"],highlightReconstructionMethod:"ciraw-highlight-v1"}));
} else if (args[0] === "decode") {
  if (mode === "failure") { console.error("fixture RAW decode failed"); process.exit(1); }
  const pixels = new Float32Array(${width} * ${height} * 3);
  const samples = [0.1,0.2,0.3,2,1,0.5];
  for (let i = 0; i < pixels.length; i++) pixels[i] = samples[i % samples.length];
  writeFileSync(args[args.indexOf("--output") + 1], Buffer.from(pixels.buffer));
  console.log(JSON.stringify({width:${width},height:${height},channels:3,space:"scene-linear-rec2020",orientationApplied:true,wireFormat:"rgb-f32le",decoderVersion:"test",highlightReconstruction:mode,highlightReconstructionMethod:mode === "applied" ? "ciraw-highlight-v1" : undefined}));
}
`,
  );
  await chmod(path, 0o755);
  return path;
}
