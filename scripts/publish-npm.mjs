import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const directory = "out/packages";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tarballs = readdirSync("packages")
  .filter((name) => name.startsWith("img-") || name.startsWith("mac-helper-"))
  .map((name) => `dzhng-openphoto-${name}-${version}.tgz`);
const cliTarball = `dzhng-openphoto-${version}.tgz`;
tarballs.push(cliTarball);
for (const tarball of tarballs) {
  if (!existsSync(join(directory, tarball)))
    throw new Error(`Missing release artifact: ${tarball}`);
}
// Publish optional platform dependencies before the CLI that references them.
tarballs.sort((a, b) => Number(a === cliTarball) - Number(b === cliTarball) || a.localeCompare(b));
for (const tarball of tarballs) {
  execFileSync("npm", ["publish", join(directory, tarball), "--provenance", "--access", "public"], {
    stdio: "inherit",
  });
}
