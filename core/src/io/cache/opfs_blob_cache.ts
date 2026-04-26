/**
 * `OpfsBlobCache` — OPFS-backed copy of the source trajectory bytes,
 * paired with `OPFSSyncRangeSource` so the worker can read straight out
 * of OPFS via a `FileSystemSyncAccessHandle`.
 *
 * Why cache the source at all (we already cache the index)? Once the
 * user re-opens a known trajectory, source bytes still come from a
 * fresh `Blob`. The Blob is backed by either the original filesystem
 * file (drag-drop) or a network response (vsc-ext); the latter would
 * re-download. Persistent OPFS storage gives the network case a 1-RTT
 * skip on every reload and lets the worker read straight into WASM
 * linear memory via the sync handle.
 *
 * Layout: `/molvis/v1/blob/<fingerprint>`. The cache is opt-in — we
 * don't auto-promote every trajectory the user loads (a 50 GB
 * trajectory would saturate quota). The page surfaces a "Pin to cache"
 * action which calls `set()`.
 */

import {
  getFileIfExists,
  getOpfsBucket,
  removeEntryIfExists,
  safeKey,
} from "./opfs_root";

export const OpfsBlobCache = {
  async has(fingerprint: string): Promise<boolean> {
    return (await getFileIfExists("blob", keyFor(fingerprint))) !== null;
  },

  async set(fingerprint: string, blob: Blob): Promise<void> {
    const dir = await getOpfsBucket("blob");
    if (!dir) {
      throw new Error("OpfsBlobCache: OPFS unavailable");
    }
    const handle = await dir.getFileHandle(keyFor(fingerprint), {
      create: true,
    });
    const writable = await handle.createWritable();
    try {
      // Modern `FileSystemWritableFileStream` supports `pipeTo`,
      // which overlaps reads from the Blob with writes to OPFS for
      // ~2× throughput on multi-GB blobs versus a serial loop.
      await blob.stream().pipeTo(writable);
    } catch (err) {
      try {
        await writable.abort();
      } catch {
        // best-effort
      }
      throw err;
    }
  },

  evict(fingerprint: string): Promise<void> {
    return removeEntryIfExists("blob", keyFor(fingerprint));
  },

  /** Worker-side: open a cached file as a `FileSystemSyncAccessHandle`.
   *  Returns `null` for cache miss or if sync access is unavailable. */
  async openSync(
    fingerprint: string,
  ): Promise<FileSystemSyncAccessHandle | null> {
    const handle = await getFileIfExists("blob", keyFor(fingerprint));
    if (!handle) return null;
    const sync = handle as unknown as {
      createSyncAccessHandle?: () => Promise<FileSystemSyncAccessHandle>;
    };
    if (!sync.createSyncAccessHandle) return null;
    return await sync.createSyncAccessHandle();
  },
};

function keyFor(fingerprint: string): string {
  return safeKey(fingerprint);
}
