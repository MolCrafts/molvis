/**
 * Wire protocol between the trajectory worker (which owns the
 * `TrajectorySource` and the WASM streaming reader) and the main-thread
 * `TrajectoryRuntime`.
 *
 * All numeric byte offsets are JS `number` (safe-int up to 2^53). The
 * streaming protocol caps trajectory size at 1 TB, well within safe-int —
 * see docs/specs/streaming-trajectory.md for the rationale.
 *
 * Every typed-array field in a `FrameMessage` is added to the
 * `postMessage` transfer list — ownership moves to the receiver, the
 * sender must not retain references after sending.
 */

export type Format = "lammps-dump" | "xyz" | "pdb" | "lammps" | "sdf";

// ---------------------------------------------------------------------------
//  Source handles
// ---------------------------------------------------------------------------

/**
 * Source handle the worker sees. We deliberately do NOT pass the
 * `Blob` directly through `postMessage` — Chrome (especially in dev
 * mode under HMR wrapping) silently drops or stalls main→worker
 * messages whose payload references very large Blobs. Instead the
 * worker is told the source size + kind, then issues `request-bytes`
 * messages back to the main thread for each byte range it needs. The
 * main thread holds the live Blob and answers with transferable
 * `ArrayBuffer`s — zero clone, zero size limit.
 */
export interface BlobSourceHandle {
  kind: "blob";
  totalBytes: number;
}

/**
 * OPFS-backed source. The worker resolves the path under
 * `/molvis/v1/blob/<filename>` and opens a
 * `FileSystemSyncAccessHandle` for it. Reads happen synchronously
 * inside the worker — no `request-bytes` round trip — so this path is
 * substantially cheaper than the blob path on hot frame loads.
 */
export interface OpfsSourceHandle {
  kind: "opfs";
  /** Filename inside the `/molvis/v1/blob/` bucket. */
  filename: string;
}

export type SourceHandle = BlobSourceHandle | OpfsSourceHandle;

// ---------------------------------------------------------------------------
//  Frame payload — the wire format for a single Frame
// ---------------------------------------------------------------------------

export type ColumnPayload =
  | { name: string; dtype: "f64"; data: Float64Array }
  | { name: string; dtype: "u32"; data: Uint32Array }
  | { name: string; dtype: "i32"; data: Int32Array }
  | { name: string; dtype: "string"; data: string[] };

export interface BlockPayload {
  name: string;
  columns: ColumnPayload[];
}

export interface SimboxPayload {
  /** Column-major 3×3 lattice matrix, length 9. */
  h: Float64Array;
  /** Cartesian origin in Å, length 3. */
  origin: Float64Array;
  pbc: [boolean, boolean, boolean];
}

export interface GridPayload {
  name: string;
  /** [nx, ny, nz]. */
  shape: Uint32Array;
  /** Cartesian origin in Å, length 3. */
  origin: Float64Array;
  /** Column-major lattice matrix, length 9. */
  cell: Float64Array;
  pbc: [boolean, boolean, boolean];
  arrays: { name: string; data: Float64Array }[];
}

// ---------------------------------------------------------------------------
//  Main → worker requests
// ---------------------------------------------------------------------------

export interface OpenRequest {
  kind: "open";
  requestId: number;
  source: SourceHandle;
  format: Format;
  /** Bytes per indexer feed call. Default 8 MiB.
   *
   *  Smaller values reduce peak WASM memory at the cost of more wasm-bindgen
   *  round trips. Larger values improve indexer throughput but raise the
   *  floor on WASM linear memory and on the indexing-progress refresh
   *  granularity. */
  chunkSize?: number;
  /** Cache key used to consult the `.molidx` sidecar before scanning
   *  and to write a fresh sidecar after a successful index pass. When
   *  omitted (e.g. for ad-hoc Blobs without identity), the worker
   *  always re-indexes from scratch. */
  fingerprint?: string;
}

export interface LoadFrameRequest {
  kind: "load-frame";
  requestId: number;
  frameId: number;
}

export interface CancelRequest {
  kind: "cancel";
  requestId: number;
  /** The `requestId` of the original open / load-frame request to cancel. */
  targetRequestId: number;
}

export interface CloseRequest {
  kind: "close";
  requestId: number;
}

/**
 * Worker → main: ask for a byte range from the source. The main thread
 * answers with a `BytesResponse` whose `data` is the transferred
 * `ArrayBuffer`.
 */
export interface RequestBytes {
  kind: "request-bytes";
  /** Worker-chosen id; main thread echoes it on the response. */
  fetchId: number;
  byteOffset: number;
  byteLen: number;
}

/**
 * Main → worker: bytes for an earlier `request-bytes`. The
 * `ArrayBuffer` is transferred (zero copy). On read errors the
 * `error` field is set instead.
 */
export interface BytesResponse {
  kind: "bytes";
  fetchId: number;
  data: ArrayBuffer | null;
  error?: string;
}

export type WorkerRequest =
  | OpenRequest
  | LoadFrameRequest
  | CancelRequest
  | CloseRequest
  | BytesResponse;

// ---------------------------------------------------------------------------
//  Worker → main responses
// ---------------------------------------------------------------------------

export interface IndexProgress {
  kind: "index-progress";
  requestId: number;
  bytesScanned: number;
  totalBytes: number;
  framesIndexedSoFar: number;
}

export interface IndexReady {
  kind: "index-ready";
  requestId: number;
  frameCount: number;
  totalBytes: number;
}

export interface OpenError {
  kind: "open-error";
  requestId: number;
  message: string;
}

export interface FrameMessage {
  kind: "frame";
  requestId: number;
  frameId: number;
  blocks: BlockPayload[];
  simbox: SimboxPayload | null;
  grids: GridPayload[];
}

export interface FrameError {
  kind: "frame-error";
  requestId: number;
  frameId: number;
  message: string;
}

export interface ClosedAck {
  kind: "closed";
  requestId: number;
}

/**
 * Worker → main: posted once at the end of worker module init. The
 * runtime defers all outbound business messages until this arrives —
 * Chrome dev-mode module workers silently drop pre-init messages
 * instead of buffering them.
 */
export interface WorkerHeartbeat {
  kind: "worker-heartbeat";
}

export type WorkerResponse =
  | IndexProgress
  | IndexReady
  | OpenError
  | FrameMessage
  | FrameError
  | ClosedAck
  | RequestBytes
  | WorkerHeartbeat;

// ---------------------------------------------------------------------------
//  Transfer-list helpers
// ---------------------------------------------------------------------------

/**
 * Collect all transferable buffers in a `FrameMessage`. Pass the result as
 * the second argument to `postMessage` so ownership moves to the receiver.
 *
 * The worker MUST NOT retain references to any of these arrays after
 * `postMessage` — they are detached by structured cloning.
 */
export function frameMessageTransferList(msg: FrameMessage): Transferable[] {
  const out: Transferable[] = [];
  for (const block of msg.blocks) {
    for (const col of block.columns) {
      if (col.dtype !== "string") out.push(col.data.buffer);
    }
  }
  if (msg.simbox) {
    out.push(msg.simbox.h.buffer);
    out.push(msg.simbox.origin.buffer);
  }
  for (const grid of msg.grids) {
    out.push(grid.shape.buffer);
    out.push(grid.origin.buffer);
    out.push(grid.cell.buffer);
    for (const arr of grid.arrays) out.push(arr.data.buffer);
  }
  return out;
}
