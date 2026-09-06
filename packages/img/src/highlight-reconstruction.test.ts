import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  decodeLibraw,
  developCameraFront,
  linearRec2020ToDisplaySrgb,
  probeLibraw,
  resamplePixels,
} from "./index.js";

const candle = fileURLToPath(new URL("../../../fixtures/camera/DSC00107.ARW", import.meta.url));

test("source probe plans the same effective method as actual native decode", async () => {
  const probe = probeLibraw(candle);
  expect(probe.highlightReconstructionMethod).toBeTruthy();
  const image = await decodeLibraw(candle, 0.25, "scene-linear-rec2020", "reconstruct");
  expect(image.highlightReconstructionMethod).toBe(probe.highlightReconstructionMethod);
  const reduced = fileURLToPath(new URL("../../../fixtures/camera/DSC00103.ARW", import.meta.url));
  expect(probeLibraw(reduced).highlightReconstructionMethod).toBeUndefined();
}, 60_000);

test("explicit native reconstruction removes candle false color without replacing RAW headroom", async () => {
  const original = await decodeLibraw(candle, 0.25, "scene-linear-rec2020");
  const recovered = await decodeLibraw(candle, 0.25, "scene-linear-rec2020", "reconstruct");
  const display = await linearRec2020ToDisplaySrgb(recovered.data);
  let magenta = 0;
  for (let y = 820; y < 1060; y++) {
    for (let x = 500; x < 615; x++) {
      const i = (y * recovered.width + x) * 3;
      if (display[i]! > 0.95 && display[i + 2]! > 0.95 && display[i + 1]! < 0.85) magenta++;
    }
  }
  expect(magenta).toBeLessThan(100);
  expect(recovered.data.some((value) => value > 1)).toBe(true);
  expect(recovered.data.every(Number.isFinite)).toBe(true);
  expect(recovered.data).not.toEqual(original.data);
}, 60_000);

test("native reconstruction preserves real orange light detail and reliable scene samples exactly", async () => {
  const sunset = fileURLToPath(new URL("../../../fixtures/camera/DSC08142.ARW", import.meta.url));
  const original = await decodeLibraw(sunset, 1, "scene-linear-rec2020");
  const recovered = await decodeLibraw(sunset, 1, "scene-linear-rec2020", "reconstruct");
  let changed = false;
  let reliableExact = true;
  for (let i = 0; i < original.data.length; i += 3) {
    const different =
      original.data[i] !== recovered.data[i] ||
      original.data[i + 1] !== recovered.data[i + 1] ||
      original.data[i + 2] !== recovered.data[i + 2];
    changed ||= different;
    if (
      original.data[i]! * 0.2627 + original.data[i + 1]! * 0.678 + original.data[i + 2]! * 0.0593 <
      0.5
    )
      reliableExact &&= !different;
  }
  expect(changed).toBe(true);
  expect(reliableExact).toBe(true);
  for (let y = 1680; y < 1760; y++) {
    const start = (y * original.width + 6820) * 3;
    expect(
      Buffer.from(original.data.buffer, start * 4, 144 * 12).equals(
        Buffer.from(recovered.data.buffer, start * 4, 144 * 12),
      ),
    ).toBe(true);
  }
}, 60_000);

test("reconstruction runs on native neighborhoods before both reductions, without a second WB", async () => {
  const native = await decodeLibraw(candle, 1, "scene-linear-rec2020", "reconstruct");
  expect(native.highlightReconstruction).toBe("applied");
  for (const scale of [0.5, 0.25]) {
    const scaled = await decodeLibraw(candle, scale, "scene-linear-rec2020", "reconstruct");
    const expected = await resamplePixels(
      native.data,
      native.width,
      native.height,
      3,
      scaled.width,
      scaled.height,
      "bilinear",
    );
    expect(Buffer.from(scaled.data.buffer).equals(Buffer.from(expected.buffer))).toBe(true);
  }
  await expect(decodeLibraw(candle, 0.25, undefined, "reconstruct")).rejects.toThrow(
    "requires scene-linear-rec2020",
  );
}, 60_000);

test("disabled reconstruction keeps camera-space and its scaled front exactly; reduced RGB is honest", async () => {
  const reduced = fileURLToPath(new URL("../../../fixtures/camera/DSC00103.ARW", import.meta.url));
  for (const scale of [1, 0.5, 0.25]) {
    const camera = await decodeLibraw(reduced, scale);
    const expected = await developCameraFront(camera);
    const disabled = await decodeLibraw(reduced, scale, "scene-linear-rec2020", "disabled");
    const requested = await decodeLibraw(reduced, scale, "scene-linear-rec2020", "reconstruct");
    expect(disabled.highlightReconstruction).toBe("disabled");
    expect(requested.highlightReconstruction).toBe("unsupported");
    expect(Buffer.from(disabled.data.buffer).equals(Buffer.from(expected.data.buffer))).toBe(true);
    expect(Buffer.from(requested.data.buffer).equals(Buffer.from(disabled.data.buffer))).toBe(true);
    if (scale === 1) {
      for (let y = 900; y < 920; y++)
        for (let x = 2200; x < 2220; x++) {
          expect(camera.data[(y * camera.width + x) * 3 + 1]).toBeGreaterThan(0);
        }
    }
  }
}, 60_000);
