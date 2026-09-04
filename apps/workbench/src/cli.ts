#!/usr/bin/env node
import { runWorkbench } from "./run.js";

try {
  const output = await runWorkbench(process.argv.slice(2), process.cwd());
  process.stdout.write(`${output}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}
