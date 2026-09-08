#!/usr/bin/env node
// Every relative markdown link in the live doc tree must resolve. Closed specs
// under specs/done are frozen records and are not checked: when it's done,
// it's done. Usage: node scripts/check-links.mjs [root]
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "target", "vendor", ".git"]);
const SKIPPED_PREFIXES = [join("specs", "done") + sep];
const LINK = /\]\(([^)\s]+)\)/g;

const root = resolve(process.argv[2] ?? ".");
const broken = [];
let checked = 0;
for (const file of await markdownFiles(root)) {
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(LINK)) {
    const link = match[1];
    if (/^(https?:|mailto:|#)/u.test(link)) continue;
    const target = link.split("#")[0];
    if (!target) continue;
    checked += 1;
    if (!(await exists(resolve(dirname(file), target)))) {
      broken.push(`${relative(root, file)}: ${link}`);
    }
  }
}
if (broken.length > 0) {
  console.error(
    `${broken.length} broken markdown link(s):\n${broken.map((line) => `  ${line}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(`Verified ${checked} links.`);

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (!entry.isDirectory()) return entry.name.endsWith(".md") ? [path] : [];
      if (SKIPPED_DIRECTORIES.has(entry.name)) return [];
      const relativePath = relative(root, path) + sep;
      if (SKIPPED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return [];
      return await markdownFiles(path);
    }),
  );
  return nested.flat();
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
