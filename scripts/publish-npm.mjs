import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const directory = "out/packages";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tarballs = readdirSync("packages")
  .filter((name) => name.startsWith("img-") || name.startsWith("mac-helper-"))
  .map((name) => `photoctl-${name}-${version}.tgz`);
tarballs.push(`photoctl-cli-${version}.tgz`);
for (const tarball of tarballs) {
  if (!existsSync(join(directory, tarball)))
    throw new Error(`Missing release artifact: ${tarball}`);
}
// Publish optional platform dependencies before the CLI that references them.
tarballs.sort(
  (a, b) =>
    Number(a.startsWith("photoctl-cli-")) - Number(b.startsWith("photoctl-cli-")) ||
    a.localeCompare(b),
);
for (const tarball of tarballs) {
  execFileSync("npm", ["publish", join(directory, tarball), "--provenance", "--access", "public"], {
    stdio: "inherit",
  });
}
