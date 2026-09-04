import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const roots = ["apps/cli", "packages"];
const packages = [];
for (const root of roots) {
  if (!statSync(root).isDirectory()) continue;
  if (root === "apps/cli") packages.push(root);
  else
    for (const name of readdirSync(root))
      if (name.startsWith("img-") || name.startsWith("mac-helper-"))
        packages.push(join(root, name));
}
if (packages.length === 0) console.log("No publishable packages yet");
for (const directory of packages) {
  const child = spawnSync("npm", ["publish", "--provenance"], { cwd: directory, stdio: "inherit" });
  if (child.status !== 0) process.exit(child.status ?? 1);
}
