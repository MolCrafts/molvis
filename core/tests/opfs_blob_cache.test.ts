import { afterEach, beforeEach, describe, expect } from "@rstest/core";
import { OpfsBlobCache } from "../src/io/cache/opfs_blob_cache";
import { clearBucket, opfsIt } from "./opfs_test_helpers";

describe("OpfsBlobCache", () => {
  beforeEach(() => clearBucket("blob"));
  afterEach(() => clearBucket("blob"));

  opfsIt("has() returns false for a missing fingerprint", async () => {
    expect(await OpfsBlobCache.has("never-written")).toBe(false);
  });

  opfsIt("set() writes the blob and has() reports true", async () => {
    const blob = new Blob(["hello world"], { type: "text/plain" });
    await OpfsBlobCache.set("fp-set", blob);
    expect(await OpfsBlobCache.has("fp-set")).toBe(true);
  });

  opfsIt("set() replaces an existing entry's contents", async () => {
    await OpfsBlobCache.set("fp-replace", new Blob(["abc"]));
    await OpfsBlobCache.set("fp-replace", new Blob(["abcdef"]));
    const handle = await OpfsBlobCache.openSync("fp-replace");
    if (!handle) return; // sync access unsupported in this runtime
    try {
      expect(handle.getSize()).toBe(6);
    } finally {
      handle.close();
    }
  });

  opfsIt("evict() removes the entry; further has() returns false", async () => {
    await OpfsBlobCache.set("fp-evict", new Blob(["x"]));
    await OpfsBlobCache.evict("fp-evict");
    expect(await OpfsBlobCache.has("fp-evict")).toBe(false);
  });

  opfsIt("evict() on a missing entry is a no-op", async () => {
    await expect(OpfsBlobCache.evict("never")).resolves.toBeUndefined();
  });

  opfsIt(
    "openSync() returns a sync handle whose size matches the blob",
    async () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      await OpfsBlobCache.set("fp-sync", new Blob([bytes]));
      const handle = await OpfsBlobCache.openSync("fp-sync");
      if (!handle) return; // sync access unsupported
      try {
        expect(handle.getSize()).toBe(8);
        const buf = new Uint8Array(8);
        handle.read(buf, { at: 0 });
        expect(Array.from(buf)).toEqual(Array.from(bytes));
      } finally {
        handle.close();
      }
    },
  );

  opfsIt("openSync() returns null for a missing key", async () => {
    expect(await OpfsBlobCache.openSync("never-written")).toBeNull();
  });
});
