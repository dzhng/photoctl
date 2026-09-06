import { registerFullFrameJourney } from "../../../test/journeys/full-frame.js";
import { spawnPhotoctl } from "@photoctl/test-harness";

registerFullFrameJourney(
  process.env.PHOTOCTL_FULL_FRAME_INSTALLED_CLI
    ? (args, options) =>
        spawnPhotoctl(args, { ...options, cliPath: process.env.PHOTOCTL_FULL_FRAME_INSTALLED_CLI })
    : undefined,
);
