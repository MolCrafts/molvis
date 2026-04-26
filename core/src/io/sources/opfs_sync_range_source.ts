/**
 * `OPFSSyncRangeSource` — worker-only `TrajectorySource` backed by a
 * `FileSystemSyncAccessHandle` over an OPFS file. Synchronous reads
 * eliminate the worker→main `request-bytes` round trip the
 * `BlobRangeSource` path needs, and they let the worker write straight
 * into a `Uint8Array` view of WASM linear memory via {@link readInto}.
 *
 * `FileSystemSyncAccessHandle` is only constructable inside Dedicated
 * Workers; calling `OPFSSyncRangeSource.open()` from the main thread
 * throws. The runtime constructs this lazily inside the worker, never
 * across the postMessage boundary.
 */

import type { TrajectorySource } from "./trajectory_source";

export class OPFSSyncRangeSource implements TrajectorySource {
  readonly kind = "opfs" as const;
  private readonly handle: FileSystemSyncAccessHandle;
  private readonly _size: number;

  private constructor(handle: FileSystemSyncAccessHandle) {
    this.handle = handle;
    this._size = handle.getSize();
  }

  /** Wrap an already-opened sync handle. The source takes ownership —
   *  call {@link close} (or `dispose`) to release it. */
  static fromHandle(handle: FileSystemSyncAccessHandle): OPFSSyncRangeSource {
    return new OPFSSyncRangeSource(handle);
  }

  size(): Promise<number> {
    return Promise.resolve(this._size);
  }

  /** Read `[start, end)`. Returns a fresh, owned `Uint8Array`. The
   *  underlying read is synchronous, but we wrap in a resolved Promise
   *  so this satisfies the `TrajectorySource` contract uniformly. */
  readRange(start: number, end: number): Promise<Uint8Array> {
    const clampedStart = Math.max(0, Math.min(start, this._size));
    const clampedEnd = Math.max(clampedStart, Math.min(end, this._size));
    const len = clampedEnd - clampedStart;
    const buf = new Uint8Array(len);
    if (len > 0) this.handle.read(buf, { at: clampedStart });
    return Promise.resolve(buf);
  }

  /** Fast path — write straight into a caller-provided buffer (typically
   *  a view onto WASM linear memory). Returns the number of bytes
   *  actually written. */
  readInto(target: Uint8Array, offset: number): Promise<number> {
    if (offset >= this._size) return Promise.resolve(0);
    const written = this.handle.read(target, { at: offset });
    return Promise.resolve(written);
  }

  /** Release the underlying access handle. Idempotent in the sense
   *  that further reads after close will throw — callers should treat
   *  the source as discarded. */
  close(): void {
    this.handle.close();
  }
}
