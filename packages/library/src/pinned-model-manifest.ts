import type { ModelManifest } from "./models.js";

// Official ONNX artifacts verified against the reference runtime; no local export.
export const PINNED_MODEL_RELEASE: ModelManifest = {
  schema: 1,
  source: {
    repository: "naver-iv/zim-anything-vitl",
    revision: "667e2d7c233f6f1cacd12ccc64bdf6cc7b5aa16d",
    directory: "zim_vit_l_2092",
  },
  artifacts: [
    {
      file: "encoder.onnx",
      sha256: "6b0360b3c32dfa11555fb1de27cd3533cec1e932204da0dec2b3772045dc7db3",
      opset: 15,
    },
    {
      file: "decoder.onnx",
      sha256: "c24a42d79053d20594760ad9afdef9cca985f29493f3e1e0fe3462ca291b57f7",
      opset: 15,
    },
  ],
};
