import { expect, test } from "vitest";
import { settingsDataSchema } from "./verbs/settings.js";

test("settings responses tolerate additive fields without inventing unrequested settings", () => {
  expect(
    settingsDataSchema.parse({
      settings: {
        models: { edit: "test/edit", future_purpose: "test/future" },
        generation: { upscale: "off", future_option: true },
        providers: {
          upscale: { "test/upscale": { configured: true, future_metadata: "value" } },
          future_kind: {},
        },
        future_setting: true,
      },
      future_envelope_field: true,
    }),
  ).toEqual({
    settings: {
      models: { edit: "test/edit" },
      generation: { upscale: "off" },
      providers: { upscale: { "test/upscale": { configured: true } } },
    },
  });
  expect(settingsDataSchema.parse({ settings: { models: { edit: "test/edit" } } })).toEqual({
    settings: { models: { edit: "test/edit" } },
  });
});
