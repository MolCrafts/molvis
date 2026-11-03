/// <reference lib="webworker" />

/**
 * Dedicated worker entrypoint for streaming trajectory parsing, installed
 * on the core workload channel via {@link installWorkloadHandler}.
 *
 * Owns:
 *   - One `TrajectorySource`: either a `MainThreadBlobSource` (the
 *     blob lives on the main thread; we pull bytes via `RequestBytes`
 *     host-calls) or an `OPFSSyncRangeSource` (OPFS-cached file,
 *     synchronous reads against a `FileSystemSyncAccessHandle`).
 *   - One per-format WebAssembly (WASM) streaming reader
 *     (`LammpsDumpStream`, etc.); each decoded frame comes back as a molrs
 *     Frame and is encoded with `encodeFrame`.
 *   - The frame index, either built from a chunked feed pass or restored
 *     from a `.molidx` sidecar in OPFS when the caller passes a
 *     fingerprint and a matching cache entry exists.
 *   - Or, for the `"mrec"` store format, one molrs `MrecReader`
 *     instead of all three: the store carries its own frame index, and the
 *     reader pulls byte ranges through a synchronous key host (in-memory
 *     map, `File` handles read with `FileReaderSync`, or an unpacked zip).
 *     Frames come back as whole molrs Frames and are encoded with
 *     `encodeFrame`, each carrying its section update ids.
 *
 * Scheduling is `"interleaved"`: a long open/index job yields at every
 * chunk read, so `load-frame` jobs are served while indexing streams —
 * scrubbing stays responsive during the scan. Cancellation is cooperative:
 * jobs poll `ctx.isCancelled()` (per chunk for the index loop, at await
 * boundaries for frame loads). Envelope, correlation, ready handshake, and
 * progress heartbeat all belong to the channel (`core/workload`).
 *
 * Keep this file dependency-light: it gets bundled separately by
 * rspack's worker loader and shouldn't drag in any of MolVis's
 * scene/rendering code.
 */

import type { MrecReader } from "@molcrafts/molvis-core/molrs";
import { OpfsBlobCache } from "@molcrafts/molvis-core/opfs";
import {
  installWorkloadHandler,
  type WorkloadWorkerContext,
} from "@molcrafts/molvis-core/workload";
import { decideMolidxUse } from "../../io/cache/molidx_codec";
import { OpfsIndexCache } from "../../io/cache/opfs_index_cache";
import { sectionUpdatesAt } from "../../io/mrec_store";
import { OPFSSyncRangeSource } from "../../io/sources/opfs_sync_range_source";
import type { TrajectorySource } from "../../io/sources/trajectory_source";
import { encodeFrame } from "./frame_codec";
import { openMrecReader } from "./mrec_reader";
import type {
  RequestBytes,
  SourceHandle,
  StreamFormat,
  TrajectoryIndexProgress,
  TrajectoryJob,
  TrajectoryJobResult,
} from "./protocol";
import { frameMessageTransferList, isMrecSourceHandle } from "./protocol";
import {
  type MolrsTrajStream,
  makeStream,
  takeFrameOffsets,
  writeStreamInput,
} from "./streams";

type OpenJob = Extract<TrajectoryJob, { kind: "open" }>;
/** An open job for a byte-stream format (everything but the mrec store). */
type StreamOpenJob = Omit<OpenJob, "format"> & { format: StreamFormat };
type LoadFrameJob = Extract<TrajectoryJob, { kind: "load-frame" }>;

// ---------------------------------------------------------------------------
//  Worker state
// ---------------------------------------------------------------------------

interface WorkerState {
  /** Feeds `feedIndexChunk` / `finishIndex`. */
  indexStream: MolrsTrajStream | null;
  /** Decodes one frame via `parseRangeInInput` while indexing continues. */
  parseStream: MolrsTrajStream | null;
  /** Active trajectory source, abstracting over blob (host-call to
   *  main thread) and OPFS (sync handle) backends. */
  source: TrajectorySource | null;
  index: FramePos[];
  /** mrec store reader — set instead of the streams/source/index trio. */
  reader: MrecReader | null;
  /** Block sections of the open store, read once at open. */
  readerBlocks: string[];
  /** Last posted mrec section ids — unchanged non-atoms blocks are omitted. */
  lastSectionUpdates: Record<string, number> | undefined;
}

/** Plain-object frame position. We never store live `FrameOffset`
 *  instances from wasm-bindgen here — those expose `byteOffset` /
 *  `byteLen` as getter properties that round-trip through wasm on every
 *  read. `takeFrameOffsets` materializes them as numbers once. */
interface FramePos {
  byteOffset: number;
  byteLen: number;
}

/** `TrajectorySource` adapter for the main-thread Blob path. The blob
 *  itself never crosses the worker boundary — we ask for byte ranges
 *  via `RequestBytes` host-calls and the runtime answers with a
 *  transferable `ArrayBuffer`.
 *
 *  `callHost` is captured from the open job's context. Host-call ids
 *  live in their own worker-realm counter, independent of job ids, so
 *  later `load-frame` jobs legally keep reading through the same
 *  captured function. */
class MainThreadBlobSource implements TrajectorySource {
  readonly kind = "blob" as const;
  constructor(
    private readonly totalBytes: number,
    private readonly callHost: WorkloadWorkerContext["callHost"],
  ) {}
  size(): Promise<number> {
    return Promise.resolve(this.totalBytes);
  }
  async readRange(start: number, end: number): Promise<Uint8Array> {
    const call: RequestBytes = { byteOffset: start, byteLen: end - start };
    const reply = await this.callHost(call);
    if (!(reply instanceof ArrayBuffer)) {
      throw new Error("worker: host byte reply was not an ArrayBuffer");
    }
    return new Uint8Array(reply);
  }
}

const state: WorkerState = {
  indexStream: null,
  parseStream: null,
  source: null,
  index: [],
  reader: null,
  readerBlocks: [],
  lastSectionUpdates: undefined,
};

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB
const PROGRESS_THROTTLE_MS = 50;

// ---------------------------------------------------------------------------
//  Job dispatch
// ---------------------------------------------------------------------------

async function dispatchJob(
  job: TrajectoryJob,
  ctx: WorkloadWorkerContext,
): Promise<{ result: TrajectoryJobResult; transfer?: Transferable[] }> {
  switch (job.kind) {
    case "open":
      return handleOpen(job, ctx);
    case "load-frame":
      return handleLoadFrame(job, ctx);
    case "close":
      return handleClose();
  }
}

installWorkloadHandler<TrajectoryJob, TrajectoryJobResult>({
  scheduling: "interleaved",
  run: dispatchJob,
});

// ---------------------------------------------------------------------------
//  Open / index pass
// ---------------------------------------------------------------------------

async function handleOpen(
  job: OpenJob,
  ctx: WorkloadWorkerContext,
): Promise<{ result: TrajectoryJobResult }> {
  if (job.format === "mrec") return openStore(job);
  return openStream({ ...job, format: job.format }, ctx);
}

/** Byte-stream open: attach the source, index it (or restore the sidecar). */
async function openStream(
  job: StreamOpenJob,
  ctx: WorkloadWorkerContext,
): Promise<{ result: TrajectoryJobResult }> {
  handleClose();
  state.indexStream = makeStream(job.format);
  state.parseStream = makeStream(job.format);
  state.index = [];

  state.source = await resolveSource(job.source, ctx.callHost);
  const totalBytes = await state.source.size();
  state.indexStream.hintTotalBytes(totalBytes);
  const fp = job.fingerprint;

  if (fp) {
    const use = decideMolidxUse(
      await OpfsIndexCache.get(fp),
      totalBytes,
      job.format,
    );
    if (use.action === "hit") {
      state.index = use.index.entries;
      return { result: openResult(totalBytes) };
    }
    if (use.action === "resume") {
      state.index = use.index.entries;
      await runIndexingPass(job, ctx, totalBytes, use.scannedBytes);
      persistIndex(fp, job.format, totalBytes, true);
      return { result: openResult(totalBytes) };
    }
  }

  await runIndexingPass(job, ctx, totalBytes, 0);
  persistIndex(fp, job.format, totalBytes, true);
  return { result: openResult(totalBytes) };
}

/**
 * mrec open: the store carries its frame index, so there is no scan — the
 * reader opens index-only and `nFrames` is the answer. Any previous
 * source (stream or store) is released first.
 */
function openStore(job: OpenJob): { result: TrajectoryJobResult } {
  if (!isMrecSourceHandle(job.source)) {
    throw new Error(
      `worker: mrec open needs an mrec store handle, got '${job.source.kind}'`,
    );
  }
  handleClose();
  const { reader, totalBytes } = openMrecReader(job.source);
  state.reader = reader;
  state.readerBlocks = reader.blockNames();
  state.lastSectionUpdates = undefined;
  return {
    result: {
      kind: "open-result",
      frameCount: reader.nFrames(),
      totalBytes,
      indexComplete: true,
    },
  };
}

/** Terminal payload for a finished index scan. */
function openResult(totalBytes: number): TrajectoryJobResult {
  return {
    kind: "open-result",
    frameCount: state.index.length,
    totalBytes,
    indexComplete: true,
  };
}

async function resolveSource(
  source: SourceHandle,
  callHost: WorkloadWorkerContext["callHost"],
): Promise<TrajectorySource> {
  if (source.kind === "blob") {
    return new MainThreadBlobSource(source.totalBytes, callHost);
  }
  if (source.kind !== "opfs") {
    throw new Error(
      `worker: byte-stream open needs a blob or opfs source, got '${source.kind}'`,
    );
  }
  const handle = await OpfsBlobCache.openSync(source.filename);
  if (!handle) {
    throw new Error(`worker: opfs source '${source.filename}' not found`);
  }
  return OPFSSyncRangeSource.fromHandle(handle);
}

/** Chunked feed loop. Cooperative cancel: `ctx.isCancelled()` is polled
 *  once per chunk; on cancel the partial streams/index/source are torn
 *  down and a "cancelled" error is thrown. The runtime submits opens
 *  with `cancelMode: "reject"`, so its promises already rejected and the
 *  resulting `{type:"error"}` reply is dropped by the unknown-id rule —
 *  throwing (instead of returning a fabricated result) keeps the caller
 *  from persisting a torn-down index as complete. */
async function runIndexingPass(
  job: StreamOpenJob,
  ctx: WorkloadWorkerContext,
  totalBytes: number,
  startAt: number,
): Promise<void> {
  if (!state.indexStream || !state.source) return;
  const chunkSize = Math.max(1, job.chunkSize ?? DEFAULT_CHUNK_SIZE);
  let bytesScanned = startAt;
  let lastProgressAt = 0;
  let announcedFirst = state.index.length >= 1;

  if (startAt > 0 && job.format === "dcd" && state.index[0]) {
    const headerEnd = state.index[0].byteOffset;
    if (headerEnd > 0) {
      const header = await state.source.readRange(0, headerEnd);
      writeStreamInput(state.indexStream, header);
      takeFrameOffsets(state.indexStream.feedIndexChunk(0, header.byteLength));
      copyDecoderState();
    }
  }

  while (bytesScanned < totalBytes) {
    if (ctx.isCancelled()) {
      state.indexStream?.free();
      state.parseStream?.free();
      state.indexStream = null;
      state.parseStream = null;
      state.index = [];
      state.source?.close?.();
      state.source = null;
      throw new Error("cancelled");
    }

    const end = Math.min(bytesScanned + chunkSize, totalBytes);
    const len = end - bytesScanned;
    const slice = await state.source.readRange(bytesScanned, end);

    writeStreamInput(state.indexStream, slice);
    state.index.push(
      ...takeFrameOffsets(state.indexStream.feedIndexChunk(bytesScanned, len)),
    );
    copyDecoderState();
    bytesScanned = end;

    if (!announcedFirst && state.index.length >= 1) {
      reportIndexProgress(ctx, bytesScanned, totalBytes);
      lastProgressAt = nowMs();
      announcedFirst = true;
      continue;
    }

    const now = nowMs();
    if (now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
      reportIndexProgress(ctx, bytesScanned, totalBytes);
      lastProgressAt = now;
      persistIndex(job.fingerprint, job.format, totalBytes, false);
    }
  }

  state.index.push(...takeFrameOffsets(state.indexStream.finishIndex()));
  copyDecoderState();
}

function reportIndexProgress(
  ctx: WorkloadWorkerContext,
  bytesScanned: number,
  totalBytes: number,
): void {
  const progress: TrajectoryIndexProgress = {
    bytesScanned,
    totalBytes,
    framesIndexedSoFar: state.index.length,
  };
  ctx.reportProgress(progress);
}

/** Best-effort `.molidx` sidecar persistence — fire-and-forget; a failed
 *  write only costs the next open a rescan. No-op without a fingerprint. */
function persistIndex(
  fingerprint: string | undefined,
  format: StreamFormat,
  fileSize: number,
  complete: boolean,
): void {
  if (!fingerprint) return;
  const last = state.index[state.index.length - 1];
  void OpfsIndexCache.set(fingerprint, {
    format,
    fileSize,
    totalBytes: fileSize,
    complete,
    scannedBytes: last ? last.byteOffset + last.byteLen : 0,
    entries: state.index,
  });
}

/** DCD parse needs the header the indexer already saw. Text / XTC / TRR
 *  streams return an empty state and this is a no-op. */
function copyDecoderState(): void {
  const decoderState = state.indexStream?.decoderState();
  if (decoderState && decoderState.length > 0) {
    state.parseStream?.setDecoderState(decoderState);
  }
}

// ---------------------------------------------------------------------------
//  Load frame
// ---------------------------------------------------------------------------

/** Decode one indexed frame. Cancel is polled at the await boundary
 *  (the byte-range read); a cancelled load throws — the runtime's
 *  reject-mode promises are already settled, so the error reply is
 *  dropped host-side, and no WASM parse work happens for the stale id. */
async function handleLoadFrame(
  job: LoadFrameJob,
  ctx: WorkloadWorkerContext,
): Promise<{ result: TrajectoryJobResult; transfer: Transferable[] }> {
  if (state.reader) return loadStoreFrame(job, ctx, state.reader);
  if (!state.parseStream || !state.source) {
    throw new Error("worker: load-frame before open");
  }
  if (ctx.isCancelled()) {
    throw new Error("cancelled"); // pre-cancelled before any work
  }

  const pos = state.index[job.frameId];
  if (!pos) {
    throw new Error(`worker: frame ${job.frameId} out of range`);
  }

  const slice = await state.source.readRange(
    pos.byteOffset,
    pos.byteOffset + pos.byteLen,
  );
  if (ctx.isCancelled()) {
    throw new Error("cancelled");
  }
  if (!state.parseStream || !state.source) {
    throw new Error("cancelled");
  }

  writeStreamInput(state.parseStream, slice);
  const frame = state.parseStream.parseRangeInInput(0, slice.byteLength);
  try {
    const msg = encodeFrame(frame, job.frameId);
    return { result: msg, transfer: frameMessageTransferList(msg) };
  } finally {
    frame.free();
  }
}

/**
 * mrec frame: the reader decodes exactly frame `t` (only its chunks cross
 * into wasm), the Frame is encoded to the wire and freed at once — a true
 * worker-side ephemeral whose whole payload now lives in JS-owned arrays.
 * The frame's section update ids ride along for the main-thread classifier.
 */
function loadStoreFrame(
  job: LoadFrameJob,
  ctx: WorkloadWorkerContext,
  reader: MrecReader,
): { result: TrajectoryJobResult; transfer: Transferable[] } {
  if (ctx.isCancelled()) {
    throw new Error("cancelled");
  }
  const frame = reader.readFrame(job.frameId);
  if (!frame) {
    throw new Error(`worker: frame ${job.frameId} out of range`);
  }
  try {
    const sectionUpdates = Object.fromEntries(
      sectionUpdatesAt(reader, state.readerBlocks, job.frameId),
    );
    const msg = encodeFrame(frame, job.frameId, {
      sectionUpdates,
      previousSectionUpdates: state.lastSectionUpdates,
    });
    state.lastSectionUpdates = sectionUpdates;
    return { result: msg, transfer: frameMessageTransferList(msg) };
  } finally {
    frame.free();
  }
}

// ---------------------------------------------------------------------------
//  Close
// ---------------------------------------------------------------------------

/** Release the WASM streams and the source. The runtime disposes its host
 *  right after submitting this job, so the `closed` reply is best-effort. */
function handleClose(): { result: TrajectoryJobResult } {
  state.indexStream?.free();
  state.parseStream?.free();
  state.indexStream = null;
  state.parseStream = null;
  state.source?.close?.();
  state.source = null;
  state.index = [];
  state.reader?.free();
  state.reader = null;
  state.readerBlocks = [];
  state.lastSectionUpdates = undefined;
  return { result: { kind: "closed" } };
}

// ---------------------------------------------------------------------------
//  Low-level helpers
// ---------------------------------------------------------------------------

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
