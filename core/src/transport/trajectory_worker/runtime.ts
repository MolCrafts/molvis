/**
 * Main-thread side of the streaming trajectory pipeline.
 *
 * `TrajectoryRuntime` owns the worker, manages requestId correlation,
 * and exposes a small async API surface on the main thread. The
 * underlying `TrajectorySource` and the WASM streaming reader live in
 * the worker; the main thread only ever sees Frames it reconstitutes
 * from typed-array payloads via {@link rehydrateFrame}.
 *
 * Lifecycle:
 *   1. Construct with an injected `Worker` and the file `format`.
 *   2. `await open(source)` — runs the (blocking) indexing pass and
 *      reports the resulting `frameCount`. Optional `onProgress` callback
 *      is invoked with byte / frame counters during the pass.
 *   3. `await loadFrame(i)` — returns a real molrs `Frame`. Caller
 *      owns the Frame and should `frame.free()` it (typically via the
 *      `Trajectory` LRU cache).
 *   4. `close()` — terminates the worker.
 *
 * The Worker is dependency-injected so tests can substitute a
 * structured-cloning fake. Production callers use the spawning helper
 * `spawnTrajectoryWorker()` below.
 */

import type { Frame } from "@molcrafts/molrs";
import type { TrajectorySource } from "../../io/sources/trajectory_source";
import { logger } from "../../utils/logger";
import { rehydrateFrame } from "./frame_codec";
import type {
  CancelRequest,
  CloseRequest,
  Format,
  IndexProgress,
  IndexReady,
  LoadFrameRequest,
  OpenError,
  OpenRequest,
  SourceHandle,
  WorkerResponse,
} from "./protocol";

export interface OpenResult {
  frameCount: number;
  totalBytes: number;
}

export type IndexProgressCallback = (event: {
  bytesScanned: number;
  totalBytes: number;
  framesIndexedSoFar: number;
}) => void;

/** Optional knobs for `TrajectoryRuntime.open`. All fields are
 *  independent — pass only what you care about. */
export interface OpenOptions {
  /** Streaming-progress callback during the (blocking) indexing pass. */
  onProgress?: IndexProgressCallback;
  /** Per-chunk feed size in bytes. Default 8 MiB. */
  chunkSize?: number;
  /** Cache key used by the `.molidx` sidecar fast path. Stable over
   *  same-file reloads but unique per (file identity × format). */
  fingerprint?: string;
}

/** Build the worker-side source descriptor for a given main-thread
 *  source. Blob sources never cross the wire as a Blob — the worker
 *  pulls bytes via `request-bytes`. OPFS sources cross as a path the
 *  worker resolves to its own sync handle. */
function workerSourceFor(
  source: TrajectorySource,
  totalBytes: number,
): SourceHandle {
  if (source.kind === "blob") return { kind: "blob", totalBytes };
  // For OPFS sources, the page-side source is purely declarative —
  // the worker re-opens its own sync handle. Today only blob and
  // opfs are defined; refine when more land.
  const opfs = source as TrajectorySource & { filename?: string };
  if (opfs.kind === "opfs" && typeof opfs.filename === "string") {
    return { kind: "opfs", filename: opfs.filename };
  }
  throw new Error(`runtime: unsupported source kind '${source.kind}'`);
}

/** Minimal Worker shape `TrajectoryRuntime` actually consumes. The real
 *  `Worker` interface satisfies this; tests can supply a fake. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (e: MessageEvent) => void,
  ): void;
  terminate(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  /** Optional progress callback (open requests only). */
  onProgress?: IndexProgressCallback;
}

export class TrajectoryRuntime {
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();
  private listener: (e: MessageEvent) => void;
  private closed = false;
  private openRequestId: number | null = null;
  /** Live source held on the main thread. The worker never sees the
   *  Blob — it asks for byte ranges via `request-bytes` and we answer
   *  with transferable ArrayBuffers, which sidesteps the silent
   *  drop-large-Blob bug Chrome exhibits in dev-mode worker channels. */
  private source: TrajectorySource | null = null;
  /** Resolves when the worker has fully initialized and registered its
   *  message listener. The runtime defers all outbound `postMessage`
   *  calls until this resolves — Chrome module workers have a
   *  long-standing issue where messages posted before module init
   *  completes are silently dropped instead of buffered. We rely on the
   *  worker emitting a `worker-heartbeat` from its module top-level. */
  private readonly workerReady: Promise<void>;
  private resolveWorkerReady!: () => void;

  constructor(
    private readonly worker: WorkerLike,
    private readonly format: Format,
  ) {
    this.workerReady = new Promise<void>((resolve) => {
      this.resolveWorkerReady = resolve;
    });
    this.listener = (e) => this.dispatch(e.data as WorkerResponse);
    this.worker.addEventListener("message", this.listener);
  }

  /** Run the (blocking) indexing pass on the source. Resolves once the
   *  worker reports `index-ready`. Rejects on `open-error` or if the
   *  runtime is closed before the pass completes.
   *
   *  When `opts.fingerprint` is set, the worker consults the
   *  `.molidx` sidecar in OPFS before scanning and writes it back
   *  after. Pass `null` (or omit) for ephemeral Blobs without stable
   *  identity. */
  async open(
    source: TrajectorySource,
    opts: OpenOptions = {},
  ): Promise<OpenResult> {
    if (this.closed) {
      throw new Error("TrajectoryRuntime: already closed");
    }
    if (this.openRequestId !== null) {
      throw new Error("TrajectoryRuntime: another open is in flight");
    }

    this.source = source;
    const totalBytes = await source.size();

    // Wait for the worker to finish module init + register its message
    // listener before posting. Chrome module workers drop pre-init
    // messages instead of buffering them.
    await this.workerReady;

    const requestId = this.nextRequestId++;
    this.openRequestId = requestId;

    return new Promise<OpenResult>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress: opts.onProgress,
      });
      const req: OpenRequest = {
        kind: "open",
        requestId,
        source: workerSourceFor(source, totalBytes),
        format: this.format,
        chunkSize: opts.chunkSize,
        fingerprint: opts.fingerprint,
      };
      this.worker.postMessage(req);
    });
  }

  /** Request the Frame at `frameId`. The returned Frame is a real molrs
   *  Frame reconstituted on the main thread from transferable typed
   *  arrays — caller owns it and must call `frame.free()` when done. */
  loadFrame(frameId: number): Promise<Frame> {
    if (this.closed) {
      return Promise.reject(new Error("TrajectoryRuntime: already closed"));
    }
    const requestId = this.nextRequestId++;
    return new Promise<Frame>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      const req: LoadFrameRequest = {
        kind: "load-frame",
        requestId,
        frameId,
      };
      this.worker.postMessage(req);
    });
  }

  /** Cancel an in-flight request by id. Idempotent — cancelling an
   *  unknown id is a no-op. Cancelling a pending request rejects its
   *  promise with `CancellationError`. */
  cancel(targetRequestId: number): void {
    if (this.closed) return;
    const requestId = this.nextRequestId++;
    const req: CancelRequest = {
      kind: "cancel",
      requestId,
      targetRequestId,
    };
    this.worker.postMessage(req);
    const pending = this.pending.get(targetRequestId);
    if (pending) {
      pending.reject(new CancellationError(targetRequestId));
      this.pending.delete(targetRequestId);
    }
    if (this.openRequestId === targetRequestId) {
      this.openRequestId = null;
    }
  }

  /** Terminate the worker and reject any in-flight requests. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Send a polite close before terminating so the worker can release
    // its source / WASM resources. Don't wait long — terminate is the
    // backstop.
    try {
      const requestId = this.nextRequestId++;
      const req: CloseRequest = { kind: "close", requestId };
      this.worker.postMessage(req);
    } catch {
      // worker may already be unreachable
    }

    for (const pending of this.pending.values()) {
      pending.reject(new Error("TrajectoryRuntime: closed"));
    }
    this.pending.clear();
    this.worker.removeEventListener("message", this.listener);
    this.worker.terminate();
  }

  // ------------------------------------------------------------------

  private dispatch(msg: WorkerResponse): void {
    switch (msg.kind) {
      case "worker-heartbeat":
        // The worker's ready signal — resolve the workerReady promise
        // so deferred outbound posts can fire.
        this.resolveWorkerReady();
        return;
      case "index-progress":
        this.onIndexProgress(msg);
        return;
      case "index-ready":
        this.onIndexReady(msg);
        return;
      case "open-error":
        this.onOpenError(msg);
        return;
      case "frame":
        this.onFrame(msg);
        return;
      case "frame-error":
        this.onFrameError(msg);
        return;
      case "closed":
        return;
      case "request-bytes":
        void this.serveBytes(msg);
        return;
    }
  }

  /** Worker asked for a byte range. Slice the Blob, transfer the
   *  ArrayBuffer back. The worker promise on the other side resolves
   *  when the `bytes` message arrives. */
  private async serveBytes(
    req: import("./protocol").RequestBytes,
  ): Promise<void> {
    if (!this.source) {
      this.worker.postMessage({
        kind: "bytes",
        fetchId: req.fetchId,
        data: null,
        error: "runtime: no source",
      });
      return;
    }
    try {
      const bytes = await this.source.readRange(
        req.byteOffset,
        req.byteOffset + req.byteLen,
      );
      // Transfer the underlying buffer instead of cloning. ArrayBuffer
      // is the canonical transferable here; once posted, the local
      // `bytes` view is detached.
      const buf = bytes.buffer;
      this.worker.postMessage(
        {
          kind: "bytes",
          fetchId: req.fetchId,
          data: buf,
        },
        [buf],
      );
    } catch (err) {
      this.worker.postMessage({
        kind: "bytes",
        fetchId: req.fetchId,
        data: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private onIndexProgress(msg: IndexProgress): void {
    const pending = this.pending.get(msg.requestId);
    pending?.onProgress?.({
      bytesScanned: msg.bytesScanned,
      totalBytes: msg.totalBytes,
      framesIndexedSoFar: msg.framesIndexedSoFar,
    });
  }

  private onIndexReady(msg: IndexReady): void {
    const pending = this.pending.get(msg.requestId);
    if (!pending) return;
    this.pending.delete(msg.requestId);
    if (this.openRequestId === msg.requestId) this.openRequestId = null;
    pending.resolve({
      frameCount: msg.frameCount,
      totalBytes: msg.totalBytes,
    } satisfies OpenResult);
  }

  private onOpenError(msg: OpenError): void {
    const pending = this.pending.get(msg.requestId);
    if (!pending) return;
    this.pending.delete(msg.requestId);
    if (this.openRequestId === msg.requestId) this.openRequestId = null;
    pending.reject(new Error(`TrajectoryRuntime open: ${msg.message}`));
  }

  private onFrame(msg: import("./protocol").FrameMessage): void {
    const pending = this.pending.get(msg.requestId);
    if (!pending) return;
    this.pending.delete(msg.requestId);
    try {
      const frame = rehydrateFrame(msg);
      pending.resolve(frame);
    } catch (err) {
      pending.reject(err as Error);
    }
  }

  private onFrameError(msg: import("./protocol").FrameError): void {
    const pending = this.pending.get(msg.requestId);
    if (!pending) return;
    this.pending.delete(msg.requestId);
    pending.reject(
      new Error(`TrajectoryRuntime frame ${msg.frameId}: ${msg.message}`),
    );
  }
}

export class CancellationError extends Error {
  constructor(public readonly cancelledRequestId: number) {
    super(`request ${cancelledRequestId} cancelled`);
    this.name = "CancellationError";
  }
}

/** Throws if the user-agent doesn't support module workers. */
function _assertWorkerCtor(): void {
  if (typeof Worker === "undefined") {
    throw new Error("TrajectoryRuntime: Worker is not available");
  }
}

/** Spawn a real worker pointing at the colocated `worker.ts`. The URL
 *  pattern is the rsbuild / rspack-supported "new URL(..., import.meta.url)"
 *  form so the worker is bundled with the rest of `@molvis/core`.
 *
 *  Tests should NOT call this — construct `TrajectoryRuntime` directly
 *  with an injected fake worker instead. */
export function spawnTrajectoryWorker(format: Format): TrajectoryRuntime {
  _assertWorkerCtor();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
    name: `trajectory-${format}`,
  });
  logger.info(`[trajectory-runtime] spawned worker for ${format}`);
  return new TrajectoryRuntime(worker as WorkerLike, format);
}
