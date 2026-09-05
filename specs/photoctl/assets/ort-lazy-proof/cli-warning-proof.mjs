import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnPhotoctl, withLibrary } from "/workspace/packages/test-harness/dist/index.js";

await withLibrary(async (parent) => {
  const library = join(parent, "library");
  const env = {
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${resolve(".")}=fixture-volume:online`,
  };
  const initialized = await spawnPhotoctl(["init", "--path", library], { env });
  if (initialized.code !== 0) throw new Error(JSON.stringify(initialized));
  await mkdir(join(library, "models"));
  for (const file of ["encoder.onnx", "decoder.onnx"])
    await copyFile(join("/opt/photoctl/models", file), join(library, "models", file));
  const imported = await spawnPhotoctl(["import", resolve("fixtures/a7c2.ARW"), "--link"], {
    libraryDir: library,
    env,
  });
  if (imported.code !== 0) throw new Error(JSON.stringify(imported));
  const result = await spawnPhotoctl(["segment", imported.json.data.ids[0], "--at", "4000,600"], {
    libraryDir: library,
    env,
  });
  const warnings = result.events.filter(
    (event) => event.event === "warn" && event.code === "runtime_warning",
  );
  if (result.code !== 0 || !warnings.some((event) => event.message.includes("Unknown CPU vendor")))
    throw new Error(JSON.stringify(result));
  console.log(
    JSON.stringify({
      code: result.code,
      warnings,
      mask: result.json.data.instances[0].mask.artifact_hash,
    }),
  );
});
