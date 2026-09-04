#!/usr/bin/env node
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

if (process.platform !== "darwin") throw new Error("fixtures:volume requires macOS hdiutil");
const image = resolve(process.argv[2] ?? "/tmp/photoctl-fixture.dmg");
const run = promisify(execFile);
await run("/usr/bin/hdiutil", [
  "create",
  "-ov",
  "-size",
  "2g",
  "-fs",
  "APFS",
  "-volname",
  "PHOTOCTL_FIXTURE",
  image,
]);
const { stdout } = await run("/usr/bin/hdiutil", ["attach", "-nobrowse", image]);
process.stdout.write(stdout);
