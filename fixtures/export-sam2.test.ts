import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { PINNED_MODEL_RELEASE } from "@photoctl/library";
import release from "./models.json";

test("the packaged runtime manifest matches the release fixture", () => {
  expect(PINNED_MODEL_RELEASE).toEqual(release);
});

test("SAM exporter exposes immutable source and ONNX contracts without weights", () => {
  const value = JSON.parse(
    execFileSync("python3", ["scripts/export-sam2.py", "--print-contract"], {
      encoding: "utf8",
    }),
  );
  expect(value).toMatchObject({
    model: {
      repository: "facebook/sam2.1-hiera-small",
      revision: "ee5bba1d82bb8749febdf90f45e84b687142ba03",
    },
    sam2_revision: "2b90b9f5ceec907a1c18123530e92e794ad901a4",
    onnxruntime_revision: "3af6be475c8ce64d3fb0851706ec7e432ad2223c",
    artifacts: [
      { file: "encoder.onnx", opset: 17 },
      { file: "decoder.onnx", opset: 16 },
    ],
  });
});

test("SAM exporter refuses a dirty source checkout", async () => {
  const checkout = await mkdtemp(join(tmpdir(), "photoctl-sam-export-checkout-"));
  try {
    execFileSync("git", ["init", "--quiet", checkout]);
    await writeFile(join(checkout, "source.py"), "pinned\n");
    execFileSync("git", ["-C", checkout, "add", "source.py"]);
    execFileSync("git", ["-C", checkout, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "pinned"]);
    const revision = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    await writeFile(join(checkout, "source.py"), "modified\n");
    const probe = [
      "import importlib.util, pathlib, sys",
      "spec=importlib.util.spec_from_file_location('export_sam2', 'scripts/export-sam2.py')",
      "module=importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "module.checkout(pathlib.Path(sys.argv[1]), sys.argv[2], 'test source')",
    ].join(";");
    expect(() => execFileSync("python3", ["-c", probe, checkout, revision])).toThrow();
  } finally {
    await rm(checkout, { recursive: true });
  }
});
