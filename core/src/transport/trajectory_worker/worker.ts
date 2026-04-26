/// <reference lib="webworker" />

/**
 * Dedicated worker entrypoint for streaming trajectory parsing.
 *
 * Owns:
 *   - One `TrajectorySource`: either a `MainThreadBlobSource` (the
 *     blob lives on the main thread; we pull bytes via `request-bytes`)
 *     or an `OPFSSyncRangeSource` (OPFS-cached file, synchronous reads
 *     against a `FileSystemSyncAccessHandle`).
 *   - One per-format WASM streaming reader (`WasmLammpsDumpStream`, etc.).
 *   - The frame index, either built from a chunked feed pass or restored
 *     from a `.molidx` sidecar in OPFS when the caller passes a
 *     fingerprint and a matching cache entry exists.
 *
 * Responds to messages from `TrajectoryRuntime` on the main thread —
 * see `protocol.ts` for the full message schema.
 *
 * Keep this file dependency-light: it gets bundled separately by
 * rspack's worker loader and shouldn't drag in any of MolVis's
 * scene/rendering code.
 */

import {
  type FrameIndexEntry,
  WasmLammpsDataStream,
  WasmLammpsDumpStream,
  WasmPdbStream,
  WasmSdfStream,
  WasmXyzStream,
  wasmMemory,
} from "@molcrafts/molrs";
import { OpfsBlobCache } from "../../io/cache/opfs_blob_cache";
import { OpfsIndexCache } from "../../io/cache/opfs_index_cache";
import { OPFSSyncRangeSource } from "../../io/sources/opfs_sync_range_source";
import type { TrajectorySource } from "../../io/sources/trajectory_source";
import type {
  BlockPayload,
  CancelRequest,
  CloseRequest,
  ColumnPayload,
  Format,
  FrameError,
  FrameMessage,
  GridPayload,
  IndexProgress,
  IndexReady,
  LoadFrameRequest,
  OpenError,
  OpenRequest,
  SimboxPayload,
  WorkerRequest,
} from "./protocol";
import { frameMessageTransferList } from "./protocol";

// ---------------------------------------------------------------------------
//  Type aliases — every wasm stream class shares the same JS-facing shape,
//  so we abstract over them with a structural type.
// ---------------------------------------------------------------------------

type WasmTrajStream =
  | WasmLammpsDumpStream
  | WasmXyzStream
  | WasmPdbStream
  | WasmLammpsDataStream
  | WasmSdfStream;

function makeStream(format: Format): WasmTrajStream {
  switch (format) {
    case "lammps-dump":
      return new WasmLammpsDumpStream();
    case "xyz":
      return new WasmXyzStream();
    case "pdb":
      return new WasmPdbStream();
    case "lammps":
      return new WasmLammpsDataStream();
    case "sdf":
      return new WasmSdfStream();
  }
}

// ---------------------------------------------------------------------------
//  Worker state
// ---------------------------------------------------------------------------

interface WorkerState {
  stream: WasmTrajStream | null;
  /** Active trajectory source, abstracting over blob (reverse-RPC to
   *  main thread) and OPFS (sync handle) backends. */
  source: TrajectorySource | null;
  index: FramePos[];
  cancelledOpenId: number | null;
  cancelledFrameIds: Set<number>;
  /** Pending byte-range requests by fetchId, resolved when the main
   *  thread responds with a `BytesResponse`. */
  pendingFetches: Map<
    number,
    { resolve: (data: ArrayBuffer) => void; reject: (err: Error) => void }
  >;
  nextFetchId: number;
}

/** Plain-object frame position. We never store live `FrameIndexEntry`
 *  instances from wasm-bindgen here — those expose `byteOffset` /
 *  `byteLen` as getter properties that round-trip through wasm on every
 *  read. `appendIndex` materializes them as numbers once. */
interface FramePos {
  byteOffset: number;
  byteLen: number;
}

/** `TrajectorySource` adapter for the main-thread Blob path. The blob
 *  itself never crosses the worker boundary — we ask for byte ranges
 *  via `request-bytes` and the runtime answers with a transferable
 *  `ArrayBuffer`. */
class MainThreadBlobSource implements TrajectorySource {
  readonly kind = "blob" as const;
  constructor(private readonly totalBytes: number) {}
  size(): Promise<number> {
    return Promise.resolve(this.totalBytes);
  }
  readRange(start: number, end: number): Promise<Uint8Array> {
    return fetchBytes(start, end - start);
  }
}

const state: WorkerState = {
  stream: null,
  source: null,
  index: [],
  cancelledOpenId: null,
  cancelledFrameIds: new Set(),
  pendingFetches: new Map(),
  nextFetchId: 1,
};

/** Ask the main thread for a byte range and wait for the answer. */
function fetchBytes(byteOffset: number, byteLen: number): Promise<Uint8Array> {
  const fetchId = state.nextFetchId++;
  return new Promise<Uint8Array>((resolve, reject) => {
    state.pendingFetches.set(fetchId, {
      resolve: (data) => resolve(new Uint8Array(data)),
      reject,
    });
    (self as unknown as Worker).postMessage({
      kind: "request-bytes",
      fetchId,
      byteOffset,
      byteLen,
    });
  });
}

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB
const PROGRESS_THROTTLE_MS = 50;

// ---------------------------------------------------------------------------
//  Message dispatch
// ---------------------------------------------------------------------------

const messageHandler = (e: MessageEvent) => {
  const msg = e.data as WorkerRequest;
  switch (msg.kind) {
    case "open":
      handleOpen(msg).catch((err) => sendOpenError(msg.requestId, err));
      return;
    case "load-frame":
      handleLoadFrame(msg).catch((err) =>
        sendFrameError(msg.requestId, msg.frameId, err),
      );
      return;
    case "cancel":
      handleCancel(msg);
      return;
    case "close":
      handleClose(msg);
      return;
    case "bytes": {
      const pending = state.pendingFetches.get(msg.fetchId);
      if (!pending) return;
      state.pendingFetches.delete(msg.fetchId);
      if (msg.error || msg.data === null) {
        pending.reject(new Error(msg.error ?? "byte-range fetch failed"));
      } else {
        pending.resolve(msg.data);
      }
      return;
    }
  }
};

self.addEventListener("message", messageHandler);

// Worker readiness signal. The runtime's `open()` blocks on this
// before posting any business message — without it, Chrome dev-mode
// module workers silently drop pre-init messages. See
// `MEMORY.md` → "Streaming trajectory worker pitfalls".
(self as unknown as Worker).postMessage({ kind: "worker-heartbeat" });

// ---------------------------------------------------------------------------
//  Open / index pass
// ---------------------------------------------------------------------------

async function handleOpen(req: OpenRequest): Promise<void> {
  rejectPendingFetches("worker: new open superseded");

  state.stream = makeStream(req.format);
  state.index = [];
  state.cancelledOpenId = null;

  state.source = await resolveSource(req.source);
  const totalBytes = await state.source.size();
  const fp = req.fingerprint;

  // Cache fast path: a sidecar with matching format + byte length is
  // structurally compatible.
  if (fp) {
    const cached = await OpfsIndexCache.get(fp);
    if (
      cached &&
      cached.totalBytes === totalBytes &&
      cached.format === req.format
    ) {
      state.index = cached.entries;
      sendIndexReady(req.requestId, totalBytes);
      return;
    }
  }

  await runIndexingPass(req, totalBytes);
  if (state.cancelledOpenId === req.requestId) return;

  // Persist the index for next time. Best-effort; `set` swallows I/O
  // failures internally. `state.index` is already the right shape.
  if (fp) {
    void OpfsIndexCache.set(fp, {
      format: req.format,
      totalBytes,
      entries: state.index,
    });
  }

  sendIndexReady(req.requestId, totalBytes);
}

async function resolveSource(
  source: OpenRequest["source"],
): Promise<TrajectorySource> {
  if (source.kind === "blob") {
    return new MainThreadBlobSource(source.totalBytes);
  }
  const handle = await OpfsBlobCache.openSync(source.filename);
  if (!handle) {
    throw new Error(`worker: opfs source '${source.filename}' not found`);
  }
  return OPFSSyncRangeSource.fromHandle(handle);
}

/** Chunked feed loop. Drops partial state and posts an open-error on
 *  cancellation; the caller checks `state.cancelledOpenId` on return
 *  to decide whether to proceed with the cache write-through. */
async function runIndexingPass(
  req: OpenRequest,
  totalBytes: number,
): Promise<void> {
  if (!state.stream || !state.source) return;
  const chunkSize = Math.max(1, req.chunkSize ?? DEFAULT_CHUNK_SIZE);
  let bytesScanned = 0;
  let lastProgressAt = 0;

  while (bytesScanned < totalBytes) {
    if (state.cancelledOpenId === req.requestId) {
      state.stream = null;
      state.index = [];
      state.source?.close?.();
      state.source = null;
      sendOpenError(req.requestId, new Error("cancelled"));
      return;
    }

    const end = Math.min(bytesScanned + chunkSize, totalBytes);
    const len = end - bytesScanned;
    const slice = await state.source.readRange(bytesScanned, end);

    const ptr = state.stream.allocInputBuffer(len);
    writeIntoWasm(ptr, slice);

    appendIndex(state.stream.feedIndexChunk(bytesScanned, len));
    bytesScanned = end;

    const now = nowMs();
    if (now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
      sendIndexProgress(req.requestId, bytesScanned, totalBytes);
      lastProgressAt = now;
    }
  }

  appendIndex(state.stream.finishIndex());
}

// ---------------------------------------------------------------------------
//  Load frame
// ---------------------------------------------------------------------------

async function handleLoadFrame(req: LoadFrameRequest): Promise<void> {
  if (!state.stream || !state.source) {
    throw new Error("worker: load-frame before open");
  }
  if (state.cancelledFrameIds.delete(req.requestId)) return; // pre-cancelled

  const pos = state.index[req.frameId];
  if (!pos) {
    throw new Error(`worker: frame ${req.frameId} out of range`);
  }

  const slice = await state.source.readRange(
    pos.byteOffset,
    pos.byteOffset + pos.byteLen,
  );
  if (state.cancelledFrameIds.delete(req.requestId)) return;

  const ptr = state.stream.allocInputBuffer(slice.byteLength);
  writeIntoWasm(ptr, slice);

  state.stream.parseRangeInInput(0, slice.byteLength);

  // Materialize the parsed frame into the wire payload while WASM
  // memory is still pinned to this parse. After releaseFrame the
  // pointers go stale; before it, every wasm call that resizes memory
  // also detaches the ArrayBuffer view, so we re-derive views as we
  // go, never cache them across calls.
  const blocks = readBlocks(state.stream);
  const simbox = readSimbox(state.stream);
  const grids = readGrids(state.stream);

  state.stream.releaseFrame();

  const msg: FrameMessage = {
    kind: "frame",
    requestId: req.requestId,
    frameId: req.frameId,
    blocks,
    simbox,
    grids,
  };
  postWithTransfer(msg, frameMessageTransferList(msg));
}

// ---------------------------------------------------------------------------
//  Output extraction — the hot path. Every wasm call may grow memory, so
//  we re-derive views per call and copy out before the next.
// ---------------------------------------------------------------------------

function readBlocks(s: WasmTrajStream): BlockPayload[] {
  const blockCount = s.blockCount();
  const out: BlockPayload[] = [];
  for (let bi = 0; bi < blockCount; bi++) {
    const blockName = s.blockName(bi);
    const colCount = s.columnCount(bi);
    const columns: ColumnPayload[] = [];
    for (let ci = 0; ci < colCount; ci++) {
      const colName = s.columnName(bi, ci);
      const dtype = s.columnDtype(bi, ci);
      const len = s.columnLen(bi, ci);
      switch (dtype) {
        case "f64": {
          const ptr = s.columnPtrF64(bi, ci);
          const view = new Float64Array(wasmMemory().buffer, ptr, len);
          columns.push({
            name: colName,
            dtype: "f64",
            data: new Float64Array(view), // copy out of WASM
          });
          break;
        }
        case "u32": {
          const ptr = s.columnPtrU32(bi, ci);
          const view = new Uint32Array(wasmMemory().buffer, ptr, len);
          columns.push({
            name: colName,
            dtype: "u32",
            data: new Uint32Array(view),
          });
          break;
        }
        case "i32": {
          const ptr = s.columnPtrI32(bi, ci);
          const view = new Int32Array(wasmMemory().buffer, ptr, len);
          columns.push({
            name: colName,
            dtype: "i32",
            data: new Int32Array(view),
          });
          break;
        }
        case "string": {
          const data = s.columnStrings(bi, ci) as string[];
          columns.push({ name: colName, dtype: "string", data });
          break;
        }
        // bool / u8 / unknown — silently dropped per spec
      }
    }
    out.push({ name: blockName, columns });
  }
  return out;
}

function readSimbox(s: WasmTrajStream): SimboxPayload | null {
  const h = s.simboxH();
  const origin = s.simboxOrigin();
  if (!h || !origin) return null;
  const pbcRaw = s.simboxPbc(); // Vec<u8>(3) per molrs-wasm impl
  const pbc = pbcToTuple(pbcRaw);
  return {
    h: new Float64Array(h),
    origin: new Float64Array(origin),
    pbc,
  };
}

function readGrids(s: WasmTrajStream): GridPayload[] {
  const gridCount = s.gridCount();
  const out: GridPayload[] = [];
  for (let gi = 0; gi < gridCount; gi++) {
    const name = s.gridName(gi);
    const shape = new Uint32Array(s.gridShape(gi));
    const origin = new Float64Array(s.gridOrigin(gi));
    const cell = new Float64Array(s.gridCell(gi));
    const pbc = pbcToTuple(s.gridPbc(gi));

    const arrayCount = s.gridArrayCount(gi);
    const arrays: { name: string; data: Float64Array }[] = [];
    for (let ai = 0; ai < arrayCount; ai++) {
      const arrName = s.gridArrayName(gi, ai);
      const len = s.gridArrayLen(gi, ai);
      const ptr = s.gridArrayPtrF64(gi, ai);
      const view = new Float64Array(wasmMemory().buffer, ptr, len);
      arrays.push({ name: arrName, data: new Float64Array(view) });
    }
    out.push({ name, shape, origin, cell, pbc, arrays });
  }
  return out;
}

function pbcToTuple(raw: unknown): [boolean, boolean, boolean] {
  // molrs-wasm emits pbc as Vec<u8>(3) where 1=true, 0=false.
  const arr = raw as ArrayLike<number> | null | undefined;
  if (!arr || arr.length < 3) return [false, false, false];
  return [Boolean(arr[0]), Boolean(arr[1]), Boolean(arr[2])];
}

// ---------------------------------------------------------------------------
//  Cancel / close
// ---------------------------------------------------------------------------

function handleCancel(req: CancelRequest): void {
  // Open-pass cancel: indexing loop checks this each chunk.
  state.cancelledOpenId = req.targetRequestId;
  // load-frame cancel: marker the frame loop checks at the await boundary.
  state.cancelledFrameIds.add(req.targetRequestId);
}

function handleClose(req: CloseRequest): void {
  state.stream?.free?.();
  state.stream = null;
  state.source?.close?.();
  state.source = null;
  state.index = [];
  state.cancelledFrameIds.clear();
  rejectPendingFetches("worker closed");
  postSelf({ kind: "closed", requestId: req.requestId });
}

/** Reject every in-flight `request-bytes` promise. Called from
 *  `handleClose` and at the top of every `handleOpen` so a torn-down
 *  open doesn't leave promises dangling on the next pass. */
function rejectPendingFetches(reason: string): void {
  for (const pending of state.pendingFetches.values()) {
    pending.reject(new Error(reason));
  }
  state.pendingFetches.clear();
}

// ---------------------------------------------------------------------------
//  Message helpers
// ---------------------------------------------------------------------------

function sendIndexProgress(
  requestId: number,
  bytesScanned: number,
  totalBytes: number,
): void {
  const msg: IndexProgress = {
    kind: "index-progress",
    requestId,
    bytesScanned,
    totalBytes,
    framesIndexedSoFar: state.index.length,
  };
  postSelf(msg);
}

function sendIndexReady(requestId: number, totalBytes: number): void {
  const msg: IndexReady = {
    kind: "index-ready",
    requestId,
    frameCount: state.index.length,
    totalBytes,
  };
  postSelf(msg);
}

function sendOpenError(requestId: number, err: Error | unknown): void {
  const msg: OpenError = {
    kind: "open-error",
    requestId,
    message: errorMessage(err),
  };
  postSelf(msg);
}

function sendFrameError(
  requestId: number,
  frameId: number,
  err: Error | unknown,
): void {
  const msg: FrameError = {
    kind: "frame-error",
    requestId,
    frameId,
    message: errorMessage(err),
  };
  postSelf(msg);
}

// ---------------------------------------------------------------------------
//  Low-level helpers
// ---------------------------------------------------------------------------

function appendIndex(entries: FrameIndexEntry[] | null | undefined): void {
  if (!entries) return;
  for (const e of entries) {
    // wasm-bindgen returns FrameIndexEntry instances with getter
    // properties — read them as plain numbers and cache for postMessage.
    state.index.push({
      byteOffset: e.byteOffset,
      byteLen: e.byteLen,
    });
  }
}

function writeIntoWasm(ptr: number, src: Uint8Array): void {
  // Re-derive the view immediately before the write — `wasmMemory()`
  // may have grown during the alloc above and detached any prior view.
  const view = new Uint8Array(wasmMemory().buffer, ptr, src.byteLength);
  view.set(src);
}

function postSelf(msg: unknown): void {
  (self as unknown as Worker).postMessage(msg);
}

function postWithTransfer(msg: unknown, transfer: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
