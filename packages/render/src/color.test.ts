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

test.each([
  {
    name: "camera front",
    convert: async (data: Float32Array) =>
      (
        await toSceneLinearRec2020({
          w: 3,
          h: 1,
          orientationApplied: true,
          space: "camera",
          data,
          whiteLevel: 2,
          blackLevel: 0.01,
          camXyz: [0.746, -0.2365, -0.0588, -0.5687, 1.3442, 0.2474, -0.0624, 0.1156, 0.6584],
          asShotWb: [2, 1, 0.5],
          wbPreApplied: false,
        })
      ).data,
    bits: [
      3174604549, 1023896790, 1054007532, 1036114226, 1037256895, 1032715030, 1074050545,
      1059952360, 3178012913,
    ],
  },
  {
    name: "display back",
    convert: linearRec2020ToDisplaySrgb,
    bits: [
      3205438413, 1057941486, 1067415221, 1043745781, 1056876556, 1058572178, 1069958681,
      1064465271, 3201283263,
    ],
  },
])("$name preserves exact pixels and caller-owned input snapshots", async ({ convert, bits }) => {
  const storage = new Float32Array([99, -0.01, 0.25, 1.5, 0.1, 0.2, 0.3, 2, 1, 0, 88]);
  const original = storage.slice();
  const input = storage.subarray(1, 10);
  const output = await convert(input);
  expect(storage).toEqual(original);
  expect([...new Uint32Array(output.buffer, output.byteOffset, output.length)]).toEqual(bits);

  const pending = convert(input);
  input.fill(42);
  const snapshot = await pending;
  expect([...new Uint32Array(snapshot.buffer, snapshot.byteOffset, snapshot.length)]).toEqual(bits);
  expect([...storage]).toEqual([99, ...Array(9).fill(42), 88]);
});
