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
 * A Frame crosses as molrs Frame bytes (`FrameMessage.bytes`), the same
 * encoding the RPC seam uses; the buffer rides the `postMessage` transfer
 * list, so ownership moves to the receiver and the sender must not retain it.
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
 * `/molvis/blob/<filename>` and opens a
 * `FileSystemSyncAccessHandle` for it. Reads happen synchronously
 * inside the worker — no host-call round trip — so this path is
 * substantially cheaper than the blob path on hot frame loads.
 */
export interface OpfsSourceHandle {
  kind: "opfs";
  /** Filename inside the `/molvis/blob/` bucket. */
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
//  Frame payload
// ---------------------------------------------------------------------------

/**
 * One decoded frame on its way to the main thread.
 *
 * `bytes` is the whole Frame as molrs Frame bytes in `FRAME_FORMAT`
 * (`transport/rpc/types.ts`), written by `writeEncodedFrame` and read back with
 * `readEncodedFrame`: blocks, every column with its dtype and validity mask,
 * block shapes, the box and the meta are inside it, and nothing in molvis
 * defines that layout. The worker puts `bytes.buffer` in the transfer list.
 */
export interface FrameMessage {
  kind: "frame";
  frameId: number;
  bytes: Uint8Array;
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
