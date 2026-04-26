import { afterEach, beforeEach, describe, expect } from "@rstest/core";
import type { CachedIndex } from "../src/io/cache/molidx_codec";
import { OpfsIndexCache } from "../src/io/cache/opfs_index_cache";
import { clearBucket, opfsIt } from "./opfs_test_helpers";

const fixture: CachedIndex = {
  format: "xyz",
  totalBytes: 1024,
  entries: [
    { byteOffset: 0, byteLen: 256 },
    { byteOffset: 256, byteLen: 768 },
  ],
};

describe("OpfsIndexCache", () => {
  beforeEach(() => clearBucket("idx"));
  afterEach(() => clearBucket("idx"));

  opfsIt("get returns null for a missing fingerprint", async () => {
    expect(await OpfsIndexCache.get("never-written")).toBeNull();
  });

  opfsIt("set then get round-trips an index", async () => {
    await OpfsIndexCache.set("fp-roundtrip", fixture);
    const loaded = await OpfsIndexCache.get("fp-roundtrip");
    expect(loaded).not.toBeNull();
    expect(loaded?.format).toBe(fixture.format);
    expect(loaded?.totalBytes).toBe(fixture.totalBytes);
    expect(loaded?.entries).toEqual(fixture.entries);
  });

  opfsIt("set overwrites a previous entry under the same key", async () => {
    await OpfsIndexCache.set("fp-overwrite", fixture);
    const updated: CachedIndex = {
      format: "pdb",
      totalBytes: 9999,
      entries: [{ byteOffset: 100, byteLen: 9899 }],
    };
    await OpfsIndexCache.set("fp-overwrite", updated);
    const loaded = await OpfsIndexCache.get("fp-overwrite");
    expect(loaded?.format).toBe("pdb");
    expect(loaded?.entries).toEqual(updated.entries);
  });

  opfsIt("evict removes the entry; subsequent get returns null", async () => {
    await OpfsIndexCache.set("fp-evict", fixture);
    await OpfsIndexCache.evict("fp-evict");
    expect(await OpfsIndexCache.get("fp-evict")).toBeNull();
  });

  opfsIt("evict on an unknown key is a no-op", async () => {
    await expect(
      OpfsIndexCache.evict("never-existed"),
    ).resolves.toBeUndefined();
  });

  opfsIt("list enumerates currently-cached fingerprints", async () => {
    await OpfsIndexCache.set("fp-a", fixture);
    await OpfsIndexCache.set("fp-b", fixture);
    const names = await OpfsIndexCache.list();
    expect(names.sort()).toEqual(["fp-a", "fp-b"]);
  });

  opfsIt(
    "filesystem-unsafe fingerprint chars are sanitized in storage",
    async () => {
      const dirty = "weird/key with*spaces?";
      await OpfsIndexCache.set(dirty, fixture);
      const loaded = await OpfsIndexCache.get(dirty);
      expect(loaded).not.toBeNull();
    },
  );
});
