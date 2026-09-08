import { join } from "node:path";
import { expect, test } from "vitest";
import {
  FileImageDecoder,
  LibrawDecoder,
  planSourceTreatment,
  type ImageSource,
} from "./decoder.js";

// Two full camera RAW decodes: this is a correctness check, not a latency gate.
test("the RAW adapter reports the planned reconstruction and preserves explicit disabled pixels", async () => {
  const source: ImageSource = {
    kind: "online-file",
    path: join(process.cwd(), "fixtures/camera/DSC00107.ARW"),
    mediaType: "image/x-sony-arw",
    w: 7008,
    h: 4672,
  };
  const decoder = new LibrawDecoder();
  const probe = await decoder.probe(source);
  const options = { scale: 0.25, outputSpace: "scene-linear-rec2020" } as const;
  const disabled = await decoder.decode(source, {
    ...options,
    highlightReconstruction: "disabled",
  });
  const recovered = await decoder.decode(source, {
    ...options,
    highlightReconstruction: "reconstruct",
  });
  expect(recovered.treatment).toEqual({
    decoderId: decoder.id,
    decoderVersion: probe.decoderVersion,
    requested: "reconstruct",
    status: "applied",
    method: probe.highlightReconstructionMethod,
    scale: 0.25,
  });
  expect(disabled.treatment).toEqual({
    decoderId: decoder.id,
    decoderVersion: probe.decoderVersion,
    requested: "disabled",
    status: "disabled",
    method: null,
    scale: 0.25,
  });
  expect(Buffer.from(recovered.data.buffer).equals(Buffer.from(disabled.data.buffer))).toBe(false);
}, 60_000);

test.each([
  [new LibrawDecoder(), "DSC00103.ARW", "image/x-sony-arw", "unsupported"],
  [new FileImageDecoder(), "DSC00103.JPG", "image/jpeg", "not-applicable"],
] as const)(
  "incapable RAW and camera JPEG retain honest treatment: %s %s",
  async (decoder, file, mediaType, status) => {
    const source: ImageSource = {
      kind: "online-file",
      path: join(process.cwd(), "fixtures/camera", file),
      mediaType,
      w: 4608,
      h: 3072,
    };
    const options = {
      scale: 0.25,
      outputSpace: "scene-linear-rec2020",
      highlightReconstruction: "reconstruct",
    } as const;
    const probe = await decoder.probe(source);
    const plan = planSourceTreatment(decoder.id, probe, options);
    const image = await decoder.decode(source, options);
    expect(image.treatment).toEqual({
      decoderId: decoder.id,
      decoderVersion: probe.decoderVersion,
      requested: "reconstruct",
      status,
      method: null,
      scale: 0.25,
    });
    expect(image.treatment).toEqual(plan);
  },
);
