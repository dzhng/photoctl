import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

// Keep module-relative data and Node's package boundaries intact in the CLI tarball.
const args = process.argv.slice(2);
const all = args.includes("--all");
const output = resolve(args.find((argument) => argument !== "--all") ?? "out/packages");
execFileSync(process.execPath, ["scripts/sync-versions.mjs", "--check"], { stdio: "inherit" });
mkdirSync(output, { recursive: true });
const root = JSON.parse(readFileSync("package.json", "utf8"));
const workspace = new Map();
for (const folder of ["apps", "packages"]) {
  for (const name of readdirSync(folder)) {
    const directory = join(folder, name);
    if (!existsSync(join(directory, "package.json"))) continue;
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    workspace.set(manifest.name, { directory, manifest });
  }
}
const staging = mkdtempSync(join(tmpdir(), "photoctl-pack-"));
try {
  const cli = workspace.get("@photoctl/cli");
  const dependencies = {};
  const optionalDependencies = {};
  const bundled = new Set();
  function copyPackage(name, destination) {
    const { directory, manifest } = workspace.get(name);
    mkdirSync(destination, { recursive: true });
    if (!existsSync(join(directory, "dist")))
      throw new Error(`Build TypeScript before packing: ${directory}`);
    for (const item of ["dist", "assets", "data"]) {
      if (existsSync(join(directory, item)))
        cpSync(join(directory, item), join(destination, item), {
          recursive: true,
          filter: (source) => !basename(source).includes(".test."),
        });
    }
    const packaged = { ...manifest };
    delete packaged.scripts;
    delete packaged.devDependencies;
    for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
      if (workspace.has(dependency)) {
        dependencies[dependency] = root.version;
        if (!bundled.has(dependency)) {
          bundled.add(dependency);
          copyPackage(dependency, join(staging, "node_modules", dependency));
        }
      } else {
        if (dependencies[dependency] && dependencies[dependency] !== version)
          throw new Error(`Conflicting dependency: ${dependency}`);
        dependencies[dependency] = version;
      }
    }
    Object.assign(optionalDependencies, manifest.optionalDependencies);
    // The CLI owns the installed closure. npm treats dependencies of a bundled
    // package as bundled too, so leave no external edges on embedded manifests.
    delete packaged.dependencies;
    delete packaged.optionalDependencies;
    writeFileSync(join(destination, "package.json"), `${JSON.stringify(packaged, null, 2)}\n`);
  }
  copyPackage(cli.manifest.name, staging);
  const cliManifest = JSON.parse(readFileSync(join(staging, "package.json"), "utf8"));
  Object.assign(cliManifest, {
    dependencies,
    optionalDependencies,
    bundledDependencies: [...bundled],
    engines: { node: ">=24" },
  });
  writeFileSync(join(staging, "package.json"), `${JSON.stringify(cliManifest, null, 2)}\n`);
  for (const license of ["LICENSE", "README.md"]) {
    if (existsSync(license)) cpSync(license, join(staging, license));
  }
  pack(staging);
  const platform = `${process.platform}-${process.arch}${process.platform === "linux" ? "-gnu" : ""}`;
  for (const { directory, manifest } of workspace.values()) {
    if (
      !manifest.name.startsWith("@photoctl/img-") &&
      !manifest.name.startsWith("@photoctl/mac-helper-")
    )
      continue;
    if (
      !all &&
      manifest.name !== `@photoctl/img-${platform}` &&
      manifest.name !== `@photoctl/mac-helper-${process.platform}-${process.arch}`
    )
      continue;
    if (!existsSync(join(directory, manifest.main)))
      throw new Error(`Build the platform runtime before packing: ${directory}`);
    if (process.platform === "darwin" && manifest.os.includes("darwin")) {
      execFileSync(
        process.execPath,
        ["scripts/audit-linkage.mjs", join(directory, manifest.main)],
        { stdio: "inherit" },
      );
    }
    pack(directory);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

function pack(directory) {
  execFileSync("npm", ["pack", "--pack-destination", output], { cwd: directory, stdio: "inherit" });
}
