/**
 * Typed parameters for the trajectory workload channel.
 *
 * The trajectory worker (which owns the `TrajectorySource` and the
 * WebAssembly (WASM) streaming reader) and the main-thread `TrajectoryRuntime` talk over the
 * core workload channel; this module supplies the job, result, progress,
 * and host-call payload types that parameterize that channel. It is not a
 * wire protocol — envelopes, correlation ids, readiness, and cancellation
 * belong to the channel itself.
 *
 * All numeric byte offsets are JS `number` (safe-int up to 2^53). The
 * streaming pipeline caps trajectory size at 1 TB, well within safe-int —
 * byte offsets stay exact without BigInt on either side of the channel.
 *
 * Every typed-array field in a `FrameMessage` is added to the
 * `postMessage` transfer list — ownership moves to the receiver, the
 * sender must not retain references after sending.
 */

export type Format =
  | "lammps-dump"
  | "xyz"
  | "pdb"
  | "lammps"
  | "sdf"
  | "dcd"
  | "xtc"
  | "trr"
  | "mrec";

/**
 * Formats decoded by a byte-range `Wasm*Stream` (frame index + one-frame
 * parse over a `SourceHandle`). `"mrec"` is the one store format: molrs's
 * `MrecReader` owns the frame index and the worker serves it keys.
 */
export type StreamFormat = Exclude<Format, "mrec">;

// ---------------------------------------------------------------------------
//  Source handles
// ---------------------------------------------------------------------------

/**
 * Source handle the worker sees. We deliberately do NOT pass the
 * `Blob` directly through `postMessage` — Chrome (especially in dev
 * mode under HMR wrapping) silently drops or stalls main→worker
 * messages whose payload references very large Blobs. Instead the
 * worker is told the source size + kind, then issues `RequestBytes`
 * host-calls back to the main thread for each byte range it needs. The
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
 * inside the worker — no host-call round trip — so this path is
 * substantially cheaper than the blob path on hot frame loads.
 */
export interface OpfsSourceHandle {
  kind: "opfs";
  /** Filename inside the `/molvis/v1/blob/` bucket. */
  filename: string;
}

/**
 * mrec store handed to the worker. Three shapes, by what the host holds:
 *
 * - `mrec-files` — the whole store already in memory, posted **once** with
 *   every buffer in the transfer list (zero copy; the sender's arrays are
 *   detached). The worker opens it through a map-backed store host, so only
 *   touched byte ranges cross into wasm.
 * - `mrec-file-tree` — browser `File` handles of the store directory
 *   (structured-clonable). The lazy path: the worker reads exactly the byte
 *   ranges a frame touches with `FileReaderSync`; nothing else leaves disk.
 * - `mrec-zip` — one packed `*.mrec.zip`, read whole by the host and
 *   transferred; the worker unpacks it (`MrecReader.fromZip`).
 */
export interface MrecFilesSourceHandle {
  kind: "mrec-files";
  files: Map<string, ArrayBuffer>;
}

export interface MrecFileTreeSourceHandle {
  kind: "mrec-file-tree";
  files: Map<string, File>;
}

export interface MrecZipSourceHandle {
  kind: "mrec-zip";
  bytes: ArrayBuffer;
}

export type MrecSourceHandle =
  | MrecFilesSourceHandle
  | MrecFileTreeSourceHandle
  | MrecZipSourceHandle;

export type SourceHandle =
  | BlobSourceHandle
  | OpfsSourceHandle
  | MrecSourceHandle;

/** Whether a source handle is one of the mrec store shapes. */
export function isMrecSourceHandle(
  source: SourceHandle,
): source is MrecSourceHandle {
  return source.kind.startsWith("mrec-");
}

/**
 * Buffers to hand `postMessage` alongside an mrec `open` job so the store
 * moves instead of being cloned. `File` handles are cloned by reference.
 */
export function mrecSourceTransferList(
  source: MrecSourceHandle,
): Transferable[] {
  switch (source.kind) {
    case "mrec-files":
      return [...source.files.values()];
    case "mrec-zip":
      return [source.bytes];
    case "mrec-file-tree":
      return [];
  }
}

// ---------------------------------------------------------------------------
//  Frame payload — the transferable encoding of a single Frame
// ---------------------------------------------------------------------------

export type ColumnPayload =
  | { name: string; dtype: "f64"; data: Float64Array }
  | { name: string; dtype: "u64"; data: BigUint64Array }
  | { name: string; dtype: "i32"; data: Int32Array }
  | { name: string; dtype: "string"; data: string[] };

export interface BlockPayload {
  name: string;
  columns: ColumnPayload[];
  /**
   * Multi-dimensional block shape (volumetric grids: `[nx, ny, nz]`), set
   * only when the block is not a plain row table. Rehydration re-applies it
   * with `Block.setShape`.
   */
  shape?: Uint32Array;
}

export interface BoxPayload {
  /** Column-major 3×3 lattice matrix, length 9. */
  h: Float64Array;
  /** Cartesian origin in Å, length 3. */
  origin: Float64Array;
  pbc: [boolean, boolean, boolean];
}

export interface FrameMessage {
  kind: "frame";
  frameId: number;
  blocks: BlockPayload[];
  box: BoxPayload | null;
  /**
   * Numeric per-frame metadata (`Frame.getMetaScalar` names), when the
   * source carries any (mrec `step` / `time` / thermo scalars).
   */
  meta?: Record<string, number>;
  /**
   * String per-frame metadata (`Frame.getMeta` names). Carried separately
   * from {@link meta} because the two are distinct dtypes on the frame and
   * the getters do not cross over — a label like a LAMMPS `dump local`
   * `dump_local_label` reads back as `undefined` from `getMetaScalar`, so a
   * numbers-only payload dropped it and the streamed copy of a frame silently
   * lost what the whole-file copy kept.
   */
  metaText?: Record<string, string>;
  /**
   * mrec only: block name → the store update id this frame resolves to
   * (`MrecReader.blockUpdateAt`). Equal ids across two frames prove
   * identical rows; the main-thread classifier keys its position-only fast
   * path on them.
   */
  sectionUpdates?: Record<string, number>;
}

// ---------------------------------------------------------------------------
//  Workload channel parameters
// ---------------------------------------------------------------------------

/**
 * Job submitted by `TrajectoryRuntime` to the trajectory worker over the
 * workload channel.
 *
 * - `open` — attach a source, index it, and stream indexing progress.
 *   `chunkSize` is bytes per indexer feed call (default 8 MiB): smaller
 *   values reduce peak WASM memory at the cost of more wasm-bindgen round
 *   trips; larger values improve indexer throughput but raise the floor on
 *   WASM linear memory and on the indexing-progress refresh granularity.
 *   `fingerprint` is the cache key used to consult the `.molidx` sidecar
 *   before scanning and to write a fresh sidecar after a successful index
 *   pass; when omitted (e.g. for ad-hoc Blobs without identity), the
 *   worker always re-indexes from scratch.
 * - `load-frame` — decode one indexed frame; resolves with a
 *   `FrameMessage`.
 * - `close` — release the WASM streams and the source.
 */
export type TrajectoryJob =
  | {
      kind: "open";
      source: SourceHandle;
      format: Format;
      chunkSize?: number;
      fingerprint?: string;
    }
  | { kind: "load-frame"; frameId: number }
  | { kind: "close" };

/**
 * Result the worker returns for a `TrajectoryJob`, matched by kind:
 * `open` → `open-result`, `load-frame` → `FrameMessage`, `close` →
 * `closed`. `indexComplete: false` marks an early-resolved open whose
 * index scan is still running.
 */
export type TrajectoryJobResult =
  | {
      kind: "open-result";
      frameCount: number;
      totalBytes: number;
      indexComplete: boolean;
    }
  | FrameMessage
  | { kind: "closed" };

/**
 * Streaming progress reported while an `open` job indexes the source.
 */
export interface TrajectoryIndexProgress {
  bytesScanned: number;
  totalBytes: number;
  framesIndexedSoFar: number;
}

/**
 * Worker → main host-call payload: ask for a byte range from the source.
 * Correlation is carried by the workload channel's callId — no id field
 * here. The host replies with an `ArrayBuffer` holding exactly the
 * requested bytes, transferred (zero copy).
 */
export interface RequestBytes {
  byteOffset: number;
  byteLen: number;
}

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
    if (block.shape) out.push(block.shape.buffer);
  }
  if (msg.box) {
    out.push(msg.box.h.buffer);
    out.push(msg.box.origin.buffer);
  }
  return out;
}
