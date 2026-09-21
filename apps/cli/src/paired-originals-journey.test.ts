import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll } from "vitest";
import { rawTestHelper, spawnPhotoctl } from "@photoctl/test-harness";
import { registerPairedOriginalsJourney } from "../../../test/journeys/paired-originals.js";

let directory: string;
let helper: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-paired-helper-"));
  helper = await rawTestHelper(directory, "applied", [3504, 2336]);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
registerPairedOriginalsJourney((args, options = {}) =>
  spawnPhotoctl(args, {
    ...options,
    env: { ...options.env, PHOTOCTL_MAC_HELPER_PATH: helper },
  }),
);
