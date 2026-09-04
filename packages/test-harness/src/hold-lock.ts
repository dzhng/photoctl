import { pathToFileURL } from "node:url";
import { openLibrary } from "@photoctl/library";

export async function holdLibraryOpen(libraryPath: string): Promise<void> {
  const library = await openLibrary(libraryPath);
  try {
    process.stdout.write("READY\n");
    await new Promise<void>((resolve) => {
      process.stdin.once("data", () => resolve());
      process.stdin.once("end", () => resolve());
    });
  } finally {
    await library.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const libraryPath = process.argv[2];
  if (!libraryPath) throw new Error("Usage: hold-lock <library>");
  await holdLibraryOpen(libraryPath);
}
