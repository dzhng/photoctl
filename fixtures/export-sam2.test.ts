import { execFileSync } from "node:child_process";
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
