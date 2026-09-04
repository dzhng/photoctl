import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";

export function resolveMacHelperPath(explicit?: string): string {
  if (explicit) return explicit;
  const packaged = fileURLToPath(new URL("../bin/photoctl-mac", import.meta.url));
  const development = fileURLToPath(
    new URL("../../../helpers/mac/.build/debug/photoctl-mac", import.meta.url),
  );
  return [packaged, development].find(isExecutable) ?? "photoctl-mac";
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
