import type { TrajectorySource } from "./trajectory_source";

/**
 * `TrajectorySource` backed by a browser `Blob` or `File`.
 *
 * `Blob.prototype.slice(start, end)` returns a view onto the underlying
 * byte source without copying — the actual bytes only flow when the
 * caller materializes them (`arrayBuffer`, `text`, `stream`). The slice
 * also tolerates out-of-range bounds by clamping, which we rely on
 * instead of pre-validating.
 *
 * The whole class is structured-cloneable: `Blob` itself clones by
 * reference across `postMessage`, so handing a `BlobRangeSource` to a
 * worker is free.
 */
export class BlobRangeSource implements TrajectorySource {
  readonly kind = "blob" as const;
  /** Exposed publicly so `TrajectoryRuntime.toSourceHandle` can pass
   *  the underlying `Blob` to the worker without a type-system cast. */
  readonly blob: Blob;

  constructor(blob: Blob) {
    this.blob = blob;
  }

  size(): Promise<number> {
    return Promise.resolve(this.blob.size);
  }

  async readRange(start: number, end: number): Promise<Uint8Array> {
    const buf = await this.blob.slice(start, end).arrayBuffer();
    return new Uint8Array(buf);
  }
}
