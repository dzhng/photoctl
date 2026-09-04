#!/usr/bin/env node
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const options = parseArgs(process.argv.slice(2));
const source = resolve("fixtures/a7c2.ARW");
const template = await readFile(new URL("../xmp/classic.xmp", import.meta.url), "utf8");
await mkdir(options.out, { recursive: true });
for (let index = 1; index <= options.count; index += 1) {
  const stem = `DSC${String(index).padStart(5, "0")}`;
  const raw = join(options.out, `${stem}.ARW`);
  await copyFile(source, raw);
  const padding = Buffer.alloc(4096 + index, index % 251);
  await appendFile(raw, padding);
  await writeFile(join(options.out, `${stem}.xmp`), template, "utf8");
}
process.stdout.write(`${options.out}\n`);

function parseArgs(args) {
  let count;
  let out;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--count") count = Number(args[++index]);
    else if (args[index] === "--out") out = resolve(args[++index] ?? "");
    else throw new Error(`Unexpected argument: ${args[index]}`);
  }
  if (!Number.isSafeInteger(count) || count < 1 || !out) {
    throw new Error("usage: fixtures:drive --count N --out DIR");
  }
  return { count, out };
}
