import { copyFileSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

if (process.platform === "darwin") {
  const destination = join("packages", `mac-helper-darwin-${process.arch}`, "photoctl-mac");
  copyFileSync(
    `helpers/mac/.build/${process.argv.includes("--release") ? "release" : "debug"}/photoctl-mac`,
    destination,
  );
  chmodSync(destination, 0o755);
  execFileSync("codesign", ["--force", "--sign", "-", destination], { stdio: "inherit" });
}
