import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const platform = `${process.platform}-${process.arch}`;
const targets = {
  "darwin-arm64": [
    "libphotoctl_image.dylib",
    "img-darwin-arm64",
    "photoctl-image.darwin-arm64.node",
  ],
  "darwin-x64": ["libphotoctl_image.dylib", "img-darwin-x64", "photoctl-image.darwin-x64.node"],
  "linux-arm64": [
    "libphotoctl_image.so",
    "img-linux-arm64-gnu",
    "photoctl-image.linux-arm64-gnu.node",
  ],
  "linux-x64": ["libphotoctl_image.so", "img-linux-x64-gnu", "photoctl-image.linux-x64-gnu.node"],
};
const target = targets[platform];
if (!target) throw new Error(`Unsupported native package target: ${platform}`);
const [library, packageDirectory, addon] = target;
const destination = join("packages", packageDirectory, addon);
mkdirSync(join("packages", packageDirectory), { recursive: true });
copyFileSync(join("target", "debug", library), destination);
console.log(`Packaged ${destination}`);
