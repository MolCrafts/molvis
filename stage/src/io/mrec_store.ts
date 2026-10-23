/**
 * Store hosts for the molrec reader, and the per-frame section index it
 * exposes.
 *
 * `MrecReader.fromStorage(host)` pulls bytes through a synchronous
 * {@link MrecStoreHost}; only the byte ranges a frame decode touches cross
 * into wasm. Two hosts live here — one over a map already in memory, one over
 * browser `File` handles read synchronously (`FileReaderSync`, so a worker) —
 * and both the main-thread provider (`io/zarr.ts`) and the trajectory worker
 * construct them. Kept dependency-light on purpose: the worker bundle pulls
 * this module in and must not drag the scene graph along.
 */

import type { MrecReader, MrecStoreHost } from "@molcrafts/molvis-core/molrs";

/** Whether `key` is `prefix` itself or lies under it (`""` matches all). */
function underPrefix(key: string, prefix: string): boolean {
  return prefix === "" || key.startsWith(prefix);
}

/**
 * Host over a store already resident as `key → bytes`. The reader copies
 * only the ranges it reads into wasm, so the map stays the single resident
 * copy (unlike `new MrecReader(files)`, which duplicates every file
 * into wasm linear memory).
 */
export class MapMrecStoreHost implements MrecStoreHost {
  constructor(private readonly files: ReadonlyMap<string, Uint8Array>) {}

  get(key: string): Uint8Array | null {
    return this.files.get(key) ?? null;
  }

  getRange(key: string, offset: number, length: number): Uint8Array | null {
    const bytes = this.files.get(key);
    if (!bytes) return null;
    const end = length < 0 ? bytes.byteLength : offset + length;
    return bytes.subarray(offset, Math.min(end, bytes.byteLength));
  }

  size(key: string): number | null {
    return this.files.get(key)?.byteLength ?? null;
  }

  list(prefix: string): string[] {
    const out: string[] = [];
    for (const key of this.files.keys()) {
      if (underPrefix(key, prefix)) out.push(key);
    }
    return out;
  }
}

/**
 * Synchronous byte-range read of one `File`, `[offset, offset + length)`.
 * The production seam is `FileReaderSync` (worker-only); tests inject a
 * map-backed fake.
 */
export type FileRangeReadSync = (
  file: File,
  offset: number,
  length: number,
) => Uint8Array;

/** `FileReaderSync`-backed {@link FileRangeReadSync}. Worker scope only. */
export function fileReaderSyncRange(): FileRangeReadSync {
  const Ctor = (
    globalThis as {
      FileReaderSync?: new () => { readAsArrayBuffer(b: Blob): ArrayBuffer };
    }
  ).FileReaderSync;
  if (typeof Ctor !== "function") {
    throw new Error(
      "mrec file-tree store needs FileReaderSync (a dedicated worker)",
    );
  }
  const reader = new Ctor();
  return (file, offset, length) =>
    new Uint8Array(
      reader.readAsArrayBuffer(file.slice(offset, offset + length)),
    );
}

/**
 * Host over the `File` handles of an mrec directory (`key → File`), read
 * lazily: `size` and `list` come from the handles alone, and `get` /
 * `getRange` read exactly the requested bytes. This is the path where a
 * multi-gigabyte store opens without being read into memory — nothing but
 * the touched chunks ever leaves the disk.
 */
export class FileTreeMrecStoreHost implements MrecStoreHost {
  constructor(
    private readonly files: ReadonlyMap<string, File>,
    private readonly readRange: FileRangeReadSync,
  ) {}

  get(key: string): Uint8Array | null {
    const file = this.files.get(key);
    return file ? this.readRange(file, 0, file.size) : null;
  }

  getRange(key: string, offset: number, length: number): Uint8Array | null {
    const file = this.files.get(key);
    if (!file) return null;
    const end = length < 0 ? file.size : Math.min(offset + length, file.size);
    return this.readRange(file, offset, Math.max(0, end - offset));
  }

  size(key: string): number | null {
    return this.files.get(key)?.size ?? null;
  }

  list(prefix: string): string[] {
    const out: string[] = [];
    for (const key of this.files.keys()) {
      if (underPrefix(key, prefix)) out.push(key);
    }
    return out;
  }
}

/**
 * Per-section update ids of frame `t`: block name → the CSR update index the
 * frame resolves to (`blockUpdateAt`). A block absent at `t` is left out.
 * Two frames mapping a block to the same id carry identical rows — the
 * whole basis of index-driven change classification (`system/frame_diff.ts`).
 */
export function sectionUpdatesAt(
  reader: Pick<MrecReader, "blockUpdateAt">,
  blockNames: readonly string[],
  t: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const name of blockNames) {
    const update = reader.blockUpdateAt(name, t);
    if (update !== undefined) out.set(name, update);
  }
  return out;
}
