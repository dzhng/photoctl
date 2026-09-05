import { expect, test, vi } from "vitest";
import { Sam2EncoderCache } from "./sam2-encoder-cache.js";

test("SAM encoder work is shared per photo and tier while decoder prompts stay outside the cache", async () => {
  const cache = new Sam2EncoderCache<string>();
  const encode = vi.fn(async () => "embedding");

  const [first, second] = await Promise.all([
    cache.getOrEncode("photo-1", "develop", encode),
    cache.getOrEncode("photo-1", "develop", encode),
  ]);
  expect([first, second]).toEqual(["embedding", "embedding"]);
  expect(encode).toHaveBeenCalledOnce();

  await cache.getOrEncode("photo-1", "offline", async () => "offline-embedding");
  expect(cache.size).toBe(2);
  cache.invalidate("photo-1");
  expect(cache.size).toBe(0);
});

test("a failed encoder run is evicted so retry can make progress", async () => {
  const cache = new Sam2EncoderCache<string>();
  await expect(
    cache.getOrEncode("photo-1", "develop", async () => {
      throw new Error("encoder failed");
    }),
  ).rejects.toThrow("encoder failed");
  await expect(cache.getOrEncode("photo-1", "develop", async () => "retry")).resolves.toBe("retry");
});
