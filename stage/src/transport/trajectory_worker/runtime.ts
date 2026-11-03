/**
 * Main-thread side of the streaming trajectory pipeline.
 *
 * `TrajectoryRuntime` owns the worker and drives it over the core workload
 * channel ({@link WorkloadHost}): job correlation, the ready handshake, the
 * 30 s boot deadline, cancellation, and progress streaming all belong to the
 * channel — this module only supplies the trajectory job types
 * (`./protocol`) and maps channel results onto its frozen public API. The
 * underlying `TrajectorySource` and the WebAssembly (WASM) streaming reader live in the
 * worker; the main thread only ever sees Frames it reconstitutes from
 * typed-array payloads via {@link rehydrateFrame}.
 *
 * Lifecycle:
 *   1. Construct with an injected `Worker` and the file `format`.
 *   2. `await open(source)` — submits the indexing job. Resolves early on
 *      the first indexed frame so playback can start; the terminal result
 *      arrives via `whenIndexComplete` / `onIndexComplete`.
 *   3. `await loadFrame(i)` — returns a real molrs `Frame`. The caller owns
 *      it, but must not `free()` it on cache eviction: the `Trajectory`
 *      caches only drop their reference, because canvas consumers may still
 *      be bound to the frame. `Trajectory.dispose()` is the only safe place
 *      for an explicit free; otherwise the `FinalizationRegistry` reclaims.
 *   4. `close()` — releases worker resources and terminates.
 *
 * The Worker is dependency-injected so tests can substitute a
 * structured-cloning fake. Production callers spawn via
 * `spawnTrajectoryWorker` from `@molcrafts/molvis-stage/worker-spawner`.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import {
  WorkloadCancelledError,
  WorkloadHost,
} from "@molcrafts/molvis-core/workload";
import type { TrajectorySource } from "../../io/sources/trajectory_source";
import type { SectionUpdates } from "../../system/trajectory";
import { rehydrateFrame } from "./frame_codec";
import type {
  Format,
  MrecSourceHandle,
  RequestBytes,
  SourceHandle,
  TrajectoryIndexProgress,
  TrajectoryJob,
  TrajectoryJobResult,
} from "./protocol";
import { mrecSourceTransferList } from "./protocol";

/**
 * How many frames' section update ids the runtime remembers. The classifier
 * only ever asks about the last rendered frame and the one being rendered,
 * plus whatever prefetch loaded in between, so a small window suffices and
 * a long scrub cannot grow the log.
 */
export const SECTION_UPDATE_LOG_CAPACITY = 64;

export interface OpenResult {
  /** Playable frames so far (= {@link indexedLength}). */
  frameCount: number;
  indexedLength: number;
  length: number | null;
  indexComplete: boolean;
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
  /** Fires once when the index scan completes. */
  onIndexComplete?: (result: OpenResult) => void;
  /** Per-chunk feed size in bytes. Default 8 MiB. */
  chunkSize?: number;
  /** Cache key used by the `.molidx` sidecar fast path. Stable over
   *  same-file reloads but unique per (file identity × format). */
  fingerprint?: string;
}

/** Build the worker-side source descriptor for a given main-thread
 *  source. Blob sources never cross the wire as a Blob — the worker
 *  pulls bytes via `RequestBytes` host-calls. OPFS sources cross as a
 *  path the worker resolves to its own sync handle. */
function workerSourceFor(
  source: TrajectorySource,
  totalBytes: number,
): SourceHandle {
  if (source.kind === "blob" || source.kind === "host") {
    return { kind: "blob", totalBytes };
  }
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
  addEventListener(type: string, listener: (e: Event) => void): void;
  removeEventListener(type: string, listener: (e: Event) => void): void;
  terminate(): void;
}

/**
 * Bridge from the frozen addEventListener-style {@link WorkerLike} surface
 * to the property-style Worker face {@link WorkloadHost} consumes
 * (`onmessage` / `onerror` setters, `postMessage`, `terminate`).
 * Module-private: hosts and tests keep injecting `WorkerLike`; the adapter
 * never leaves this file.
 */
class WorkerLikeAdapter {
  private messageListener: ((e: Event) => void) | null = null;
  private errorListener: ((e: Event) => void) | null = null;

  constructor(private readonly inner: WorkerLike) {}

  set onmessage(handler: ((ev: MessageEvent) => void) | null) {
    if (this.messageListener) {
      this.inner.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }
    if (handler) {
      this.messageListener = (e) => handler(e as MessageEvent);
      this.inner.addEventListener("message", this.messageListener);
    }
  }

  set onerror(handler: ((ev: ErrorEvent) => void) | null) {
    if (this.errorListener) {
      this.inner.removeEventListener("error", this.errorListener);
      this.errorListener = null;
    }
    if (handler) {
      this.errorListener = (e) => handler(e as ErrorEvent);
      this.inner.addEventListener("error", this.errorListener);
    }
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.inner.postMessage(message, transfer);
  }

  terminate(): void {
    this.inner.terminate();
  }
}

/** The workload host specialized to the trajectory job envelope. */
type TrajectoryWorkloadHost = WorkloadHost<
  TrajectoryJob,
  TrajectoryJobResult,
  TrajectoryIndexProgress,
  RequestBytes,
  ArrayBuffer
>;

export class TrajectoryRuntime {
  private readonly host: TrajectoryWorkloadHost;
  private closed = false;
  /** Channel job id of the in-flight `open()` index pass, or null. Cleared
   *  when the open early-resolves (so `cancelOpen` only targets an open that
   *  has not produced a playable index yet — pre-channel behavior) and at
   *  terminal settle. */
  private openJobId: number | null = null;
  private indexing = false;
  /** Correlation id of the most recent {@link loadFrameLatest} request, or
   *  null when none is in flight — used to cancel a superseded streaming load
   *  during latest-wins scrubbing. */
  private latestFrameRequestId: number | null = null;
  private indexCompleteResolvers: Array<(result: OpenResult) => void> = [];
  private lastIndexComplete: OpenResult | null = null;
  /** mrec: frame id → section update ids, bounded to
   *  {@link SECTION_UPDATE_LOG_CAPACITY} most recent loads. */
  private readonly sectionUpdateLog = new Map<number, SectionUpdates>();
  /** Last rehydrated Frame — omitted mrec blocks are copied from here. */
  private lastRehydrated: Frame | undefined;
  /** Live source held on the main thread. The worker never sees the
   *  Blob — it asks for byte ranges via `RequestBytes` host-calls and we
   *  answer with transferable ArrayBuffers, which sidesteps the silent
   *  drop-large-Blob bug Chrome exhibits in dev-mode worker channels. */
  private source: TrajectorySource | null = null;

  constructor(
    worker: WorkerLike,
    private readonly format: Format,
  ) {
    this.host = new WorkloadHost<
      TrajectoryJob,
      TrajectoryJobResult,
      TrajectoryIndexProgress,
      RequestBytes,
      ArrayBuffer
    >({
      name: `trajectory-${format}`,
      // The double assertion is confined to this seam: WorkloadHost only
      // touches onmessage/onerror/postMessage/terminate, exactly the
      // surface the adapter implements.
      createWorker: () => new WorkerLikeAdapter(worker) as unknown as Worker,
      readyTimeoutMs: 30_000,
      onHostCall: (call) => this.serveBytes(call),
    });
  }

  /** Submit the indexing job for the source. Resolves early on the first
   *  indexed frame (`indexComplete: false`, `length: null`) so playback can
   *  start while the scan keeps running; when the scan finishes first, it
   *  resolves with the terminal result directly. Rejects with
   *  {@link CancellationError} when cancelled via {@link cancelOpen}.
   *
   *  When `opts.fingerprint` is set, the worker consults the
   *  `.molidx` sidecar in OPFS before scanning and writes it back
   *  after. Omit it for ephemeral Blobs without stable identity. */
  async open(
    source: TrajectorySource,
    opts: OpenOptions = {},
  ): Promise<OpenResult> {
    if (this.closed) {
      throw new Error("TrajectoryRuntime: already closed");
    }
    if (this.openJobId !== null || this.indexing) {
      throw new Error("TrajectoryRuntime: another open is in flight");
    }

    this.source = source;
    const totalBytes = await source.size();

    const job: TrajectoryJob = {
      kind: "open",
      source: workerSourceFor(source, totalBytes),
      format: this.format,
      ...(opts.chunkSize !== undefined ? { chunkSize: opts.chunkSize } : {}),
      ...(opts.fingerprint !== undefined
        ? { fingerprint: opts.fingerprint }
        : {}),
    };

    const ticket = this.host.submit(job, {
      onProgress: opts.onProgress,
      earlyResolve: (p) => {
        if (p.framesIndexedSoFar < 1) return undefined;
        // Early open: the index has playable frames, the scan keeps going.
        this.openJobId = null;
        this.indexing = true;
        return {
          kind: "open-result",
          frameCount: p.framesIndexedSoFar,
          totalBytes: p.totalBytes,
          indexComplete: false,
        };
      },
      cancelMode: "reject",
    });
    this.openJobId = ticket.id;

    // The terminal completion drives the index-complete surface no matter
    // whether the result promise settled early.
    this.translated(ticket.id, ticket.completion).then(
      (result) => {
        this.indexing = false;
        if (this.openJobId === ticket.id) this.openJobId = null;
        if (result.kind !== "open-result") return;
        const terminal = this.toOpenResult(result);
        this.lastIndexComplete = terminal;
        opts.onIndexComplete?.(terminal);
        for (const resolve of this.indexCompleteResolvers) resolve(terminal);
        this.indexCompleteResolvers = [];
      },
      () => {
        // Cancelled / failed opens only clear in-flight state here — the
        // rejection reaches the caller through the result promise.
        this.indexing = false;
        if (this.openJobId === ticket.id) this.openJobId = null;
      },
    );

    const result = await this.translated(ticket.id, ticket.result);
    if (result.kind !== "open-result") {
      throw new Error(
        `TrajectoryRuntime open: unexpected result '${result.kind}'`,
      );
    }
    return this.toOpenResult(result);
  }

  /** Open an mrec store: the store carries its own frame index, so this
   *  resolves once with the complete length (no early resolve, no progress).
   *  `source` buffers travel in the transfer list and are detached here.
   *  Only valid on a runtime constructed with format `"mrec"`. */
  async openStore(source: MrecSourceHandle): Promise<OpenResult> {
    if (this.closed) {
      throw new Error("TrajectoryRuntime: already closed");
    }
    if (this.format !== "mrec") {
      throw new Error(
        `TrajectoryRuntime: openStore needs an mrec runtime, got '${this.format}'`,
      );
    }
    if (this.openJobId !== null || this.indexing) {
      throw new Error("TrajectoryRuntime: another open is in flight");
    }
    const job: TrajectoryJob = { kind: "open", source, format: "mrec" };
    const ticket = this.host.submit(job, {
      transfer: mrecSourceTransferList(source),
      cancelMode: "reject",
    });
    this.openJobId = ticket.id;
    try {
      const result = await this.translated(ticket.id, ticket.result);
      if (result.kind !== "open-result") {
        throw new Error(
          `TrajectoryRuntime openStore: unexpected result '${result.kind}'`,
        );
      }
      const opened = this.toOpenResult(result);
      this.lastIndexComplete = opened;
      for (const resolve of this.indexCompleteResolvers) resolve(opened);
      this.indexCompleteResolvers = [];
      return opened;
    } finally {
      if (this.openJobId === ticket.id) this.openJobId = null;
    }
  }

  /** Section update ids the worker sent with frame `frameId`, when that
   *  frame was loaded recently (mrec only); `undefined` otherwise. */
  sectionUpdates(frameId: number): SectionUpdates | undefined {
    return this.sectionUpdateLog.get(frameId);
  }

  /** Request the Frame at `frameId`. The returned Frame is a real molrs
   *  Frame reconstituted on the main thread from transferable typed
   *  arrays — caller owns it and must call `frame.free()` when done. */
  loadFrame(frameId: number): Promise<Frame> {
    return this.loadFrameTracked(frameId).promise;
  }

  /** Single-flight frame load for latest-wins scrubbing. Cancels the
   *  previously-issued `loadFrameLatest` request (if still in flight) so the
   *  worker drops it at its next await boundary instead of grinding through a
   *  backlog of superseded frames. The cancelled load's promise rejects with
   *  {@link CancellationError}; a latest-wins seek (System._navigateTo) treats
   *  that as a benign supersession. */
  loadFrameLatest(frameId: number): Promise<Frame> {
    if (this.latestFrameRequestId !== null) {
      this.cancel(this.latestFrameRequestId);
    }
    const { requestId, promise } = this.loadFrameTracked(frameId);
    this.latestFrameRequestId = requestId;
    const clear = () => {
      if (this.latestFrameRequestId === requestId) {
        this.latestFrameRequestId = null;
      }
    };
    promise.then(clear, clear);
    return promise;
  }

  /** Submit a `load-frame` job, returning both its correlation id (so it
   *  can be cancelled) and the Frame promise. */
  private loadFrameTracked(frameId: number): {
    requestId: number;
    promise: Promise<Frame>;
  } {
    if (this.closed) {
      return {
        requestId: -1,
        promise: Promise.reject(new Error("TrajectoryRuntime: already closed")),
      };
    }
    const ticket = this.host.submit(
      { kind: "load-frame", frameId },
      { cancelMode: "reject" },
    );
    const promise = this.translated(ticket.id, ticket.result).then((result) => {
      if (result.kind !== "frame") {
        throw new Error(
          `TrajectoryRuntime frame ${frameId}: unexpected result '${result.kind}'`,
        );
      }
      if (result.sectionUpdates) {
        this.recordSectionUpdates(frameId, result.sectionUpdates);
      }
      const frame = rehydrateFrame(result, this.lastRehydrated);
      this.lastRehydrated = frame;
      return frame;
    });
    return { requestId: ticket.id, promise };
  }

  /** Keep the newest {@link SECTION_UPDATE_LOG_CAPACITY} frames' ids. */
  private recordSectionUpdates(
    frameId: number,
    updates: Record<string, number>,
  ): void {
    this.sectionUpdateLog.delete(frameId);
    this.sectionUpdateLog.set(frameId, new Map(Object.entries(updates)));
    while (this.sectionUpdateLog.size > SECTION_UPDATE_LOG_CAPACITY) {
      const oldest = this.sectionUpdateLog.keys().next().value;
      if (oldest === undefined) break;
      this.sectionUpdateLog.delete(oldest);
    }
  }

  /** Resolves when the current index scan completes. */
  get whenIndexComplete(): Promise<OpenResult> {
    if (this.lastIndexComplete?.indexComplete) {
      return Promise.resolve(this.lastIndexComplete);
    }
    return new Promise((resolve) => {
      this.indexCompleteResolvers.push(resolve);
    });
  }

  /** Cancel the in-flight {@link open} index pass, if any. */
  cancelOpen(): void {
    if (this.openJobId !== null) {
      this.cancel(this.openJobId);
    }
  }

  /** Cancel an in-flight request by id. Idempotent — cancelling an
   *  unknown id is a no-op. Cancelling a pending request rejects its
   *  promise with `CancellationError`. */
  cancel(targetRequestId: number): void {
    if (this.closed) return;
    this.host.cancel(targetRequestId);
  }

  /** Terminate the worker and reject any in-flight requests. Idempotent. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Polite close first so the worker can release its source / WASM
    // resources; dispose() is the terminate backstop. submit() never throws
    // synchronously — a dead host hands back an already-rejected ticket
    // whose built-in catch swallows the rejection.
    this.host.submit({ kind: "close" });
    // One microtask so an already-ready host actually posts the close job
    // before dispose() marks it dead.
    await Promise.resolve();
    this.host.dispose();
  }

  // ------------------------------------------------------------------

  /** Translate the channel's cancel rejection into the public
   *  {@link CancellationError} at the module boundary —
   *  `WorkloadCancelledError` never escapes this file. */
  private translated<T>(jobId: number, p: Promise<T>): Promise<T> {
    return p.catch((err: unknown) => {
      if (err instanceof WorkloadCancelledError) {
        throw new CancellationError(jobId);
      }
      throw err;
    });
  }

  /** Map a worker `open-result` payload onto the public {@link OpenResult}.
   *  A not-yet-complete index has no known total length. */
  private toOpenResult(result: {
    frameCount: number;
    totalBytes: number;
    indexComplete: boolean;
  }): OpenResult {
    return {
      frameCount: result.frameCount,
      indexedLength: result.frameCount,
      length: result.indexComplete ? result.frameCount : null,
      indexComplete: result.indexComplete,
      totalBytes: result.totalBytes,
    };
  }

  /** Answer a worker `RequestBytes` host-call: read the range from the live
   *  source and hand the bytes back as a transferable packed buffer. Throws
   *  (→ `ok: false` reply) when no source is attached or the read fails. */
  private async serveBytes(
    call: RequestBytes,
  ): Promise<{ result: ArrayBuffer; transfer: Transferable[] }> {
    if (!this.source) {
      throw new Error("runtime: no source");
    }
    const bytes = await this.source.readRange(
      call.byteOffset,
      call.byteOffset + call.byteLen,
    );
    if (!(bytes instanceof Uint8Array)) {
      throw new Error("runtime: readRange did not return Uint8Array");
    }
    // Copy into a packed buffer before transfer. Hosts (VS Code IPC)
    // often hand back a view onto a larger pooled buffer; transferring
    // `bytes.buffer` would send the wrong bytes and detach the pool.
    const packed = new Uint8Array(bytes.byteLength);
    packed.set(bytes);
    return { result: packed.buffer, transfer: [packed.buffer] };
  }
}

export class CancellationError extends Error {
  constructor(public readonly cancelledRequestId: number) {
    super(`request ${cancelledRequestId} cancelled`);
    this.name = "CancellationError";
  }
}
