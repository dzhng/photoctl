import { describe, expect, test } from "vitest";
import { cacheWriteError, sourceChangedError, sourceReadError } from "./errors.js";

describe("sourceReadError", () => {
  test.each([
    ["ENOENT", "not_found"],
    ["EACCES", "file_offline"],
    ["EPERM", "file_offline"],
    ["EIO", "file_offline"],
    ["ESTALE", "file_offline"],
    ["EINVAL", "unsupported_file"],
  ])("maps %s to %s", (systemCode, protocolCode) => {
    const error = Object.assign(new Error(systemCode), { code: systemCode });
    expect(sourceReadError(error, "/volume/photo.arw")).toMatchObject({ code: protocolCode });
  });
});

test("a source mutation is a stable data error that callers can identify", () => {
  expect(sourceChangedError("/volume/photo.arw")).toMatchObject({
    code: "unsupported_file",
    data: { path: "/volume/photo.arw", reason: "changed_during_import" },
  });
});

describe("cacheWriteError", () => {
  test("maps a known destination failure to the cache path", () => {
    expect(cacheWriteError("/cache/library")).toMatchObject({
      code: "volume_readonly",
      data: { path: "/cache/library" },
    });
  });
});
