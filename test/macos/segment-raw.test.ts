import { resolve } from "node:path";
import { registerSegmentAtJourney } from "../journeys/segment-at.js";

registerSegmentAtJourney(
  "fixtures/a7c2.ARW",
  "real segmentation selects subjects from the default reconstructed RAW source",
  resolve("helpers/mac/.build/debug/photoctl-mac"),
);
