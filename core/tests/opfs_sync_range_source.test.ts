import { afterEach, beforeEach, describe, expect } from "@rstest/core";
import { OpfsBlobCache } from "../src/io/cache/opfs_blob_cache";
import { OPFSSyncRangeSource } from "../src/io/sources/opfs_sync_range_source";
import { clearBucket, opfsIt } from "./opfs_test_helpers";

async function withSource(
  fingerprint: string,
  bytes: ArrayBuffer | Uint8Array,
  fn: (src: OPFSSyncRangeSource) => Promise<void> | void,
): Promise<void> {
  await OpfsBlobCache.set(fingerprint, new Blob([bytes]));
  const handle = await OpfsBlobCache.openSync(fingerprint);
  if (!handle) return; // sync access unsupported in this runtime
  const src = OPFSSyncRangeSource.fromHandle(handle);
  try {
    await fn(src);
  } finally {
    src.close();
  }
}

describe("OPFSSyncRangeSource", () => {
  beforeEach(() => clearBucket("blob"));
  afterEach(() => clearBucket("blob"));

  opfsIt("size() reports the cached file's byte length", async () => {
    const payload = new Uint8Array(12);
    await withSource("fp-size", payload, async (src) => {
      expect(await src.size()).toBe(12);
    });
  });

  opfsIt("readRange returns the requested slice as an owned copy", async () => {
    const payload = new Uint8Array([10, 20, 30, 40, 50, 60]);
    await withSource("fp-read", payload, async (src) => {
      const slice = await src.readRange(2, 5);
      expect(Array.from(slice)).toEqual([30, 40, 50]);
    });
  });

  opfsIt("readRange clamps an end past the file size", async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    await withSource("fp-clamp", payload, async (src) => {
      const slice = await src.readRange(1, 999);
      expect(Array.from(slice)).toEqual([2, 3, 4]);
    });
  });

  opfsIt(
    "readInto writes into a caller-provided buffer and returns bytes written",
    async () => {
      const payload = new Uint8Array([9, 8, 7, 6, 5, 4]);
      await withSource("fp-readinto", payload, async (src) => {
        const target = new Uint8Array(4);
        const n = await src.readInto(target, 1);
        expect(n).toBe(4);
        expect(Array.from(target)).toEqual([8, 7, 6, 5]);
      });
    },
  );

  opfsIt("identifies as kind 'opfs'", async () => {
    await withSource("fp-kind", new Uint8Array([0]), async (src) => {
      expect(src.kind).toBe("opfs");
    });
  });
});
