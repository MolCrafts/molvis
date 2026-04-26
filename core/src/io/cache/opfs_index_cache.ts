/**
 * `.molidx` sidecar storage in OPFS.
 *
 * Indexing a multi-hundred-MB trajectory takes seconds; the resulting
 * offset table is a few KB to a few MB. Writing it once and reading it
 * back on the next page load skips the whole indexing pass. Layout:
 *
 *   /molvis/v1/idx/<fingerprint>.molidx     # binary, see molidx_codec
 *
 * Best-effort: any I/O error degrades to a cache miss, and the worker
 * falls back to its normal indexing pass. Shared between the main
 * thread and the dedicated trajectory worker — both see the same
 * `navigator.storage` view of OPFS.
 */

import { logger } from "../../utils/logger";
import { type CachedIndex, decodeMolidx, encodeMolidx } from "./molidx_codec";
import {
  getFileIfExists,
  getOpfsBucket,
  removeEntryIfExists,
  safeKey,
} from "./opfs_root";

const FILE_SUFFIX = ".molidx";

export const OpfsIndexCache = {
  async get(fingerprint: string): Promise<CachedIndex | null> {
    const handle = await getFileIfExists("idx", filenameFor(fingerprint));
    if (!handle) return null;
    try {
      const file = await handle.getFile();
      return decodeMolidx(await file.arrayBuffer());
    } catch (err) {
      logger.warn(
        `[opfs-idx] read failed for '${fingerprint}': ${describeErr(err)}`,
      );
      return null;
    }
  },

  async set(fingerprint: string, idx: CachedIndex): Promise<void> {
    const dir = await getOpfsBucket("idx");
    if (!dir) return;
    try {
      const handle = await dir.getFileHandle(filenameFor(fingerprint), {
        create: true,
      });
      const writable = await handle.createWritable();
      await writable.write(encodeMolidx(idx));
      await writable.close();
    } catch (err) {
      logger.warn(
        `[opfs-idx] write failed for '${fingerprint}': ${describeErr(err)}`,
      );
    }
  },

  evict(fingerprint: string): Promise<void> {
    return removeEntryIfExists("idx", filenameFor(fingerprint));
  },

  async list(): Promise<string[]> {
    const dir = await getOpfsBucket("idx");
    if (!dir) return [];
    const out: string[] = [];
    try {
      const iter = dir as unknown as AsyncIterable<
        [string, FileSystemHandle]
      > & { entries?: () => AsyncIterable<[string, FileSystemHandle]> };
      const entries = iter.entries ? iter.entries() : iter;
      for await (const [name] of entries) {
        if (name.endsWith(FILE_SUFFIX)) {
          out.push(name.slice(0, -FILE_SUFFIX.length));
        }
      }
    } catch (err) {
      logger.warn(`[opfs-idx] list failed: ${describeErr(err)}`);
    }
    return out;
  },
};

function filenameFor(fingerprint: string): string {
  return `${safeKey(fingerprint)}${FILE_SUFFIX}`;
}

function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
