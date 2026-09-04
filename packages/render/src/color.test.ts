import { expect, test } from "vitest";
import {
  displaySrgbToLinearRec2020,
  linearRec2020ToDisplaySrgb,
  toSceneLinearRec2020,
  type LinearImage,
} from "./index.js";

test("the shared camera front honors LibRaw's normalized cam_xyz convention", async () => {
  const camera: LinearImage = {
    w: 1,
    h: 1,
    orientationApplied: true,
    space: "camera",
    data: new Float32Array([0.0591147596, 0.6667711961, 0.6932441792]),
    whiteLevel: 1,
    blackLevel: 0,
    camXyz: [0.746, -0.2365, -0.0588, -0.5687, 1.3442, 0.2474, -0.0624, 0.1156, 0.6584],
    asShotWb: [1, 1, 1],
    wbPreApplied: true,
  };

  const actual = await toSceneLinearRec2020(camera);

  expect(actual).toMatchObject({ space: "scene-linear-rec2020", whiteLevel: 1, blackLevel: 0 });
  expect([...actual.data]).toEqual([
    expect.closeTo(0.06134874, 5),
    expect.closeTo(0.65341692, 5),
    expect.closeTo(0.68975585, 5),
  ]);
});

test("scene-linear input does not receive the camera front twice", async () => {
  const scene: LinearImage = {
    w: 1,
    h: 1,
    orientationApplied: true,
    space: "scene-linear-rec2020",
    data: new Float32Array([0.1, 0.2, 0.3]),
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };

  expect(await toSceneLinearRec2020(scene)).toBe(scene);
});

test("the shared display transform retains negative out-of-gamut direction", async () => {
  const output = await linearRec2020ToDisplaySrgb(new Float32Array([-0.01, -0.01, -0.01]));
  expect([...output].every((sample) => sample < 0)).toBe(true);
});

test("an asynchronous color transform snapshots its input before returning", async () => {
  const input = new Uint16Array(3_000_000).fill(65_535);
  const conversion = displaySrgbToLinearRec2020(input);
  input.fill(0);

  expect((await conversion)[0]).toBeCloseTo(1, 5);
});
