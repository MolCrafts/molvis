/**
 * A `TrajectorySource` is an opaque byte-range provider for a single
 * trajectory file. It is the input boundary of the streaming reader path:
 * the worker pulls byte ranges from a `TrajectorySource` and feeds them
 * into the WASM `FrameIndexBuilder` / `parse_range_in_input` calls.
 *
 * Two backends are planned:
 *
 * - `BlobRangeSource` — wraps a `File` / `Blob` from `<input type=file>`
 *   or drag-drop. Available everywhere `Blob.prototype.slice` is, including
 *   inside Dedicated Workers. This is the MVP backend.
 *
 * - `OPFSSyncRangeSource` — wraps a `FileSystemSyncAccessHandle` for
 *   trajectories that have been transcoded into the OPFS binary cache.
 *   Sync access handles are worker-only and let us read straight into a
 *   `Uint8Array` view of WASM linear memory, eliminating one copy in the
 *   cached path. Phase 4.
 *
 * Both backends are structured-cloneable across `postMessage` so the
 * runtime on the main thread can construct a source and hand ownership
 * to the worker without re-opening the file.
 */
export interface TrajectorySource {
  /** Discriminant — keeps the worker switching cheap and lets future
   *  backends introduce themselves without touching unrelated code. */
  readonly kind: "blob" | "opfs";

  /** Total byte length of the underlying file. Used to drive the
   *  indexing-progress denominator and to bound `readRange` calls. */
  size(): Promise<number>;

  /** Read the byte range `[start, end)` and return it as an owned
   *  `Uint8Array` in JS-managed memory. Implementations should clamp
   *  out-of-range bounds to `[0, size]` rather than throw. */
  readRange(start: number, end: number): Promise<Uint8Array>;

  /**
   * Optional fast-path: read directly into a caller-provided buffer.
   * Returns the number of bytes actually written.
   *
   * Only the OPFS backend implements this. Blob backends fall back to
   * `readRange` + `target.set(...)` in the worker. This is the API that
   * lets the worker write straight into a view of WASM linear memory.
   */
  readInto?(target: Uint8Array, offset: number): Promise<number>;

  /** Optional release hook. The OPFS backend uses it to close its
   *  `FileSystemSyncAccessHandle`; blob-backed sources are no-ops. */
  close?(): void;
}
