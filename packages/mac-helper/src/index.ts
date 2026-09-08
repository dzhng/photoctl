import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function resolveMacHelperPath(explicit?: string): string {
  if (explicit) return explicit;
  try {
    return require.resolve(`@dzhng/openphoto-mac-helper-${process.platform}-${process.arch}`);
  } catch {
    return "photoctl-mac";
  }
}
