import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("release model verification binds real bytes and rejects corrupted or missing assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-release-models-"));
  const manifest = join(directory, "expected.json");
  const script = fileURLToPath(
    new URL("../../../scripts/verify-release-models.mjs", import.meta.url),
  );
  const contents = ["encoder fixture", "decoder fixture"];
  const artifacts = ["encoder.onnx", "decoder.onnx"].map((file, i) => ({
    file,
    sha256: createHash("sha256").update(contents[i]!).digest("hex"),
    opset: 17,
  }));
  const verify = () =>
    execFileSync(process.execPath, [script, directory, manifest], {
      encoding: "utf8",
      stdio: "pipe",
    });
  try {
    await writeFile(
      manifest,
      JSON.stringify({
        schema: 1,
        status: "ready",
        source: { repository: "test/model", revision: "a".repeat(40) },
        artifacts,
      }),
    );
    for (const [i, artifact] of artifacts.entries())
      await writeFile(join(directory, artifact.file), contents[i]!);
    verify();
    expect(await readFile(join(directory, "SHA256SUMS"), "utf8")).toBe(
      artifacts.map((a) => `${a.sha256}  ${a.file}\n`).join(""),
    );
    expect(await readFile(join(directory, "models.json"), "utf8")).toBe(
      await readFile(manifest, "utf8"),
    );
    await writeFile(join(directory, "decoder.onnx"), "corrupt");
    expect(verify).toThrow(/decoder.onnx/);
    await rm(join(directory, "encoder.onnx"));
    expect(verify).toThrow(/encoder.onnx/);
  } finally {
    await rm(directory, { recursive: true });
  }
});
