import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { envelopeExamples } from "./envelopes.js";
import { renderEnvelopeReport } from "./report.js";

export async function runWorkbench(args: string[], cwd: string): Promise<string> {
  const [command, ...rest] = args;
  if (command !== "envelope" || rest.length > 0) {
    throw new Error("usage: wb envelope");
  }

  const outputDirectory = join(cwd, "out", "wb");
  const output = join(outputDirectory, "envelope.html");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(output, renderEnvelopeReport(envelopeExamples), "utf8");
  return output;
}
