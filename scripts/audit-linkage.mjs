import { execFileSync } from "node:child_process";

if (process.argv.length < 3) throw new Error("usage: audit-linkage.mjs <Mach-O>...");
for (const file of process.argv.slice(2)) {
  const output = execFileSync("otool", ["-l", file], { encoding: "utf8" });
  for (const block of output.split(/Load command \d+/u)) {
    if (!/cmd LC_(?:LOAD|LOAD_WEAK|REEXPORT|LAZY_LOAD|LOAD_UPWARD)_DYLIB/u.test(block)) continue;
    const dependency = /\bname (.+) \(offset/u.exec(block)?.[1];
    if (!dependency?.startsWith("/usr/lib/") && !dependency?.startsWith("/System/Library/")) {
      throw new Error(`${file} depends on a non-system library: ${dependency}`);
    }
  }
}
