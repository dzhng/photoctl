import { fileURLToPath } from "node:url";

/** ICC's unmodified sRGB2014 profile bundled for deterministic preview tagging. */
export const srgb2014ProfilePath = fileURLToPath(
  new URL("../assets/sRGB2014.icc", import.meta.url),
);
