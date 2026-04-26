# Spec: streaming-trajectory

## Summary

Replace the current "load entire file as string → pass to WASM → parse all at
once" path with a worker-resident streaming pipeline:

```
File / Blob (browser)
   ↓ blob.slice(start, end)
Dedicated Worker
   ↓ writes byte range into reusable WASM input buffer
molrs-wasm streaming reader
   ↓ chunked FrameIndexBuilder → frame index
   ↓ parse_range_in_input(frame_byte_range)
typed-array payload (transferable)
   ↓ postMessage with transfer list
main thread
   ↓ reconstitutes a real molrs Frame
Trajectory.fromAsyncProvider
   ↓
System.seekFrame (async) → System.frame (sync cache)
```

Two architectural decisions drive everything in this spec:

1. **`Trajectory` is the only producer of `Frame`.** No parallel
   `RenderableFrame` type. The worker emits typed arrays as a wire format;
   the main thread reconstitutes a real molrs `Frame` from them. Modifier
   pipeline, Artist, ImpostorState, all `Command` consumers — none of them
   need to change.
2. **Format-specific decoration is a pipeline modifier, not a loader
   side-effect.** `decorateFrame` (and `writeBackboneBlock` inside it) is
   deleted. Auto-attaching modifiers detect qualifying fields on the freshly
   loaded frame and add themselves to the pipeline. Users see them and can
   remove them.

## Motivation

Today `loadTextTrajectory(content: string, …)` requires the entire trajectory
text to be materialized as one JS string and copied into WASM linear memory
before any frame is available. The browser path therefore:

- Must hold the whole file in JS heap (UTF-16) **and** WASM heap (UTF-8).
- Calls `content.as_bytes().to_vec()` inside the WASM constructor, doubling
  WASM memory peak.
- Cannot start indexing until the entire file has crossed the JS↔WASM
  boundary.

Plus the `decorateFrame(frame, format, content)` post-processing step keeps a
reference to the original text on the main thread so PDB ribbon parsing
(`writeBackboneBlock`) can scan for backbone atoms a second time. This is
fundamentally incompatible with streaming, and it's the wrong layer for
format-specific semantics anyway — those belong in the modifier pipeline.

## Scope

### In scope

- New trait `FrameIndexBuilder` in `molrs-io` with implementations for all
  five text formats currently shipped: LAMMPS dump, XYZ, PDB, LAMMPS data,
  SDF.
- New `WasmTrajStream` family in `molrs-wasm` (one class per format) exposing
  a uniform buffer-oriented API.
- `core/src/io/sources/`: `TrajectorySource` interface + `BlobRangeSource`
  implementation. (`OPFSSyncRangeSource` is a follow-up phase, not part of
  this spec's MVP.)
- `core/src/transport/trajectory_worker/{worker.ts, runtime.ts}`: dedicated
  worker that owns one source + one wasm stream per `Trajectory`; bridge on
  the main thread.
- Async extension to `Trajectory`: `Trajectory.fromAsyncProvider({ length,
  get(i): Promise<Frame> })`. The existing sync `fromProvider` stays for
  in-process / test fixtures.
- `System.seekFrame` becomes async; `System.frame` stays a synchronous getter
  backed by a `_currentFrame` cache (single-frame retention plus optional
  ring around the playhead).
- Auto-detecting decoration modifiers, replacing `decorateFrame`:
  `BackboneRibbonModifier` (PDB-shape atoms) ships in this scope. Stubs
  for VASP volumetric data are out of scope; covered by Task #12 not
  this spec.
- Page UI: `DataSourceModifier` switches to the streaming runtime; status
  bar shows `Indexing trajectory… N frames` during the blocking index pass.

### Out of scope (deferred)

- OPFS binary trajectory cache (Phase 4 — Tasks #9, #10 in the task list).
- `.molidx` sidecar (Phase 5 — Task #11).
- Progressive / non-blocking indexing. Indexing is a single blocking pass
  per `open` request. The status bar shows progress; the user can cancel.
- Multi-trajectory `SharedWorker` pool. One Dedicated Worker per
  `Trajectory`. When a `Trajectory` is disposed its worker is terminated.
- Compressed inputs (`.gz`, `.bz2`). Source-level decompression is a
  separate problem; if needed, add a `DecompressedBlobRangeSource` later.
- Non-text formats (zarr, mol2, gro, cif, poscar/contcar, cube). zarr is
  already lazy and stays on its current path. Other formats keep their
  existing whole-file readers until a follow-up spec covers them.
- Edit mode mutations. Edit mode already uses a staging pattern that clones
  the current frame into a working pool; that pool stays main-thread.
  Streaming has no implication for edit-mode semantics in this spec.

---

## Architecture Mapping

### Layer Impact

| Layer | Impact | Files |
|-------|--------|-------|
| molrs-io (Rust) | New trait + 5 impls | `molrs-io/src/streaming.rs` (new); `molrs-io/src/{lammps_dump,xyz,pdb,lammps_data,sdf}.rs` (extend) |
| molrs-wasm | 5 new wasm classes + reusable buffers | `molrs-wasm/src/io/streaming.rs` (new) |
| core sources | New | `core/src/io/sources/{trajectory_source.ts,blob_range_source.ts}` |
| core worker | New | `core/src/transport/trajectory_worker/{worker.ts,runtime.ts,protocol.ts,frame_codec.ts}` |
| core trajectory | Extend | `core/src/system/trajectory.ts` (`fromAsyncProvider`); `core/src/system.ts` (`seekFrame` async, `_currentFrame`); `core/src/io/index.ts` (`loadFileContent` switches to streaming) |
| core io | Remove | `core/src/io/reader.ts::decorateFrame`, `core/src/io/reader.ts::loadTextTrajectory` (legacy path retired in Phase 3); the `writeBackboneBlock` import in `reader.ts` goes with it |
| core pipeline | New auto-modifier | `core/src/pipeline/auto_modifiers/backbone_ribbon.ts` (Task #12 — referenced by this spec but specced separately) |
| Artist / SceneIndex / Mode / Command | None | unchanged |
| page | UI hook + status | `page/src/ui/modes/view/modifiers/DataSourceModifier.tsx`; `page/src/ui/status/IndexingStatus.tsx` (or reuse `status-message` event) |
| vsc-ext | None expected | webview already loads `@molvis/core`; the worker URL must resolve through rsbuild's `new Worker(new URL(…))` pattern (verify CSP) |

### Events

| Event | Status | Payload |
|-------|--------|---------|
| `trajectory-change` | existing | unchanged |
| `frame-change` | existing | unchanged (still emits after `_currentFrame` is updated) |
| `status-message` | existing | reused for `Indexing trajectory… N frames` and indexing-failure messages |
| `frame-load-start` | **new** | `{ frameId: number, requestId: number }` — emitted when `seekFrame` issues a worker request that didn't hit cache |
| `frame-load-end` | **new** | `{ frameId: number, requestId: number, success: boolean }` |

`frame-load-start/end` lets the page show a transient spinner during slow
parses without polling. They're emitted in pairs around the worker round trip.

---

## molrs-io: `FrameIndexBuilder` trait

```rust
// molrs-io/src/streaming.rs

/// One frame's location inside the source byte stream.
#[derive(Debug, Clone, Copy)]
pub struct FrameIndexEntry {
    pub byte_offset: u64,
    pub byte_len: u32,
}

/// Stream-friendly indexer: callers feed the raw file as zero-copy chunks
/// in source order; the indexer produces frame entries as soon as it has
/// scanned past their tail bytes.
///
/// The trait is intentionally `&mut self` rather than consuming so that
/// implementations can reuse internal scratch (line buffer, partial-frame
/// state) across calls.
pub trait FrameIndexBuilder: Send {
    /// Push the next chunk of bytes. `global_offset` is the absolute byte
    /// position of `chunk[0]` inside the source stream.
    ///
    /// Implementations MUST tolerate chunks that split lines (LF or CRLF
    /// in the middle), and MUST tolerate frames that span multiple chunks.
    fn feed(&mut self, chunk: &[u8], global_offset: u64);

    /// Drain frame entries that have been fully observed since the last
    /// `drain` (or `feed` if no prior `drain`). Successive calls are
    /// monotonic — each entry is yielded exactly once.
    fn drain(&mut self) -> Vec<FrameIndexEntry>;

    /// Called once the source has reached EOF. Yields any trailing frame
    /// that was held back because its end wasn't yet observed.
    ///
    /// Returns `Result` so the per-frame `byte_len` overflow check
    /// (frame size > `u32::MAX`) can surface as an error rather than a
    /// panic. After `finish`, the indexer is exhausted; further `feed`
    /// calls must panic — the type system also enforces this since
    /// `finish` consumes the box.
    fn finish(self: Box<Self>) -> std::io::Result<Vec<FrameIndexEntry>>;

    /// How many bytes have been consumed so far. Used by the worker to
    /// drive `index-progress` reports.
    fn bytes_seen(&self) -> u64;
}
```

Each format implements its own state machine. Sketches below — full
implementation belongs to Task #3.

### LAMMPS dump

State: `LineBuf` (carries partial trailing line) + `FrameStart` (offset of
the most-recent unfinalized frame, or `None`).

Frame boundary detection:

- Scan for line whose `trim()` starts with `ITEM: TIMESTEP`.
- When found at byte offset `o`:
  - If a previous `FrameStart = Some(p)` exists, emit
    `{ byte_offset: p, byte_len: (o - p) as u32 }` to the drain queue.
  - Set `FrameStart = Some(o)`.
- On `finish`: if `FrameStart = Some(p)`, emit
  `{ byte_offset: p, byte_len: (bytes_seen - p) as u32 }`.

Edge cases the test matrix must cover:

- Chunk boundary lands inside the literal `ITEM: TIMESTEP`.
- Chunk boundary at byte 0 of a `TIMESTEP` line.
- File starts with `ITEM: UNITS` / `ITEM: TIME` (per current `parse_single_frame` tolerance).
- Missing trailing newline on last data row.

### XYZ / extXYZ

State: `LineBuf` + `Phase` (`AwaitingNatoms`, `AwaitingComment(natoms)`,
`ConsumingAtoms(natoms, remaining)`) + `FrameStart`.

Frame boundary detection:

- In `AwaitingNatoms`: parse the trimmed line as `usize`. If valid, store
  natoms, advance to `AwaitingComment`, set `FrameStart = Some(line_offset)`.
  If not valid (blank, garbage), stay in `AwaitingNatoms` (skip and report
  via `bytes_seen`).
- In `AwaitingComment`: consume one line, advance to `ConsumingAtoms`.
- In `ConsumingAtoms`: count down on each line. When `remaining == 0`:
  emit `{ byte_offset: frame_start, byte_len: (next_line_offset - frame_start) as u32 }`
  and reset to `AwaitingNatoms`.

### PDB

State: `LineBuf` + `Mode` (`Multi` if `MODEL` has been seen, `Single`
otherwise) + `FrameStart`.

Frame boundary detection:

- Multi-frame mode: `MODEL` line starts a frame; `ENDMDL` ends it.
  `FrameStart` is set at `MODEL`'s offset; on `ENDMDL`, emit and reset.
- Single-frame fallback: if EOF is reached and `Mode == Single`, emit one
  frame spanning `[0, bytes_seen)`.

### LAMMPS data

State: trivial. The whole file is one frame. On the first `feed`,
`FrameStart = Some(0)`. On `finish`, emit `{ 0, bytes_seen as u32 }`.

`byte_len` overflow: file > 4 GiB needs `u64`; for now, enforce
`bytes_seen <= u32::MAX` and return an error from `finish` otherwise. A
later spec can lift this.

### SDF

State: scan for line equal to `$$$$` (record terminator). Each record is one
frame. `FrameStart = Some(0)` at construction; on each `$$$$` at offset `o`,
emit `{ frame_start, (o + 4 - frame_start) as u32 }` (include the
terminator) and set `FrameStart = Some(o + 5)` (past LF).

---

### Per-frame parser surface

Each format must also expose:

```rust
/// Parse exactly one frame from a tightly-bounded byte slice. The slice
/// must be a `byte_offset..byte_offset+byte_len` slice produced by the
/// matching `FrameIndexBuilder`.
pub fn parse_frame_bytes(bytes: &[u8]) -> std::io::Result<Frame>;
```

Most existing parsers (LAMMPS dump's `parse_single_frame`, XYZ's
`parse_xyz_frame`, etc.) already work over `BufRead`. Re-expose them as
`fn parse_frame_bytes(bytes: &[u8])` thin wrappers that wrap `Cursor::new`.
No structural change required.

---

## molrs-wasm: streaming reader API

One wasm class per format. They share the same shape — the spec defines it
once; the implementation generates each via a small macro or a per-format
copy.

```rust
// molrs-wasm/src/io/streaming.rs

/// Per-format streaming reader exposed to JS. One class per format:
///   WasmLammpsDumpStream, WasmXyzStream, WasmPdbStream,
///   WasmLammpsDataStream, WasmSdfStream
///
/// All five expose the same JS-facing API; documented once below.
#[wasm_bindgen(js_name = WasmLammpsDumpStream)]
pub struct WasmLammpsDumpStream {
    indexer: Box<dyn FrameIndexBuilder>,
    input_buf: Vec<u8>,
    output: Option<Frame>,    // most-recent parsed frame, until release_frame
}
```

### JS-facing methods (uniform across formats)

```typescript
declare class WasmLammpsDumpStream {
    free(): void;

    constructor();

    /** Resize the reusable input buffer to at least `len` bytes; returns the
     *  WASM linear-memory pointer. CALLER MUST RE-DERIVE THIS POINTER AFTER
     *  ANY OTHER WASM CALL — `wasm.memory.buffer` may have been detached
     *  by a grow. */
    allocInputBuffer(len: number): number; // *mut u8

    /** Current capacity of the input buffer. */
    inputCapacity(): number;

    /** Push a chunk into the indexer. Bytes must already have been written
     *  into `[allocInputBuffer + 0, allocInputBuffer + len)`. `globalOffset`
     *  is the absolute offset of those bytes in the source stream. Returns
     *  any newly-finalized frame entries since the last call.
     *
     *  Offsets are JS `number` (safe-int up to 2^53 ≈ 9 PB). The protocol
     *  caps trajectory size at 1 TB, well within safe-int. */
    feedIndexChunk(globalOffset: number, len: number): FrameIndexEntry[];

    /** Signal EOF; return any trailing frame entry. */
    finishIndex(): FrameIndexEntry[];

    /** Parse the byte range `[offset, offset + len)` of the input buffer
     *  as a frame. Replaces any prior cached frame; caller MUST extract
     *  output via the read* methods before the next parse call. */
    parseRangeInInput(offset: number, len: number): void;

    // ---- output extraction (valid only after parseRangeInInput, until releaseFrame) ----

    /** Number of blocks in the current frame. */
    blockCount(): number;
    blockName(blockIdx: number): string;

    /** Number of columns in a block. */
    columnCount(blockIdx: number): number;
    columnName(blockIdx: number, colIdx: number): string;
    columnDtype(blockIdx: number, colIdx: number): "f64" | "u32" | "i32" | "string";
    columnLen(blockIdx: number, colIdx: number): number;

    /** Pointer into WASM memory for a numeric column. CALLER MUST COPY
     *  the data into a JS-owned typed array before any other wasm call —
     *  next parseRangeInInput will overwrite it. */
    columnPtrF64(blockIdx: number, colIdx: number): number;
    columnPtrU32(blockIdx: number, colIdx: number): number;
    columnPtrI32(blockIdx: number, colIdx: number): number;

    /** String columns are returned by value (no pointer trick). */
    columnStrings(blockIdx: number, colIdx: number): string[];

    /** Box: returns null if the frame has no simulation box. */
    simboxH(): Float64Array | null;       // length 9, owned (copy)
    simboxOrigin(): Float64Array | null;  // length 3, owned (copy)
    simboxPbc(): [boolean, boolean, boolean] | null;

    /** Volumetric grids. */
    gridCount(): number;
    gridName(gridIdx: number): string;
    gridShape(gridIdx: number): Uint32Array;     // length 3, owned (copy)
    gridOrigin(gridIdx: number): Float64Array;   // length 3, owned (copy)
    gridCell(gridIdx: number): Float64Array;     // length 9, owned (copy)
    gridPbc(gridIdx: number): [boolean, boolean, boolean];
    gridArrayCount(gridIdx: number): number;
    gridArrayName(gridIdx: number, arrayIdx: number): string;
    /** Pointer into WASM memory for a grid scalar field. Same lifetime
     *  rules as columnPtrF64. */
    gridArrayPtrF64(gridIdx: number, arrayIdx: number): number;
    gridArrayLen(gridIdx: number, arrayIdx: number): number;

    /** Drop the cached output frame, allowing the next parse. */
    releaseFrame(): void;
}

interface FrameIndexEntry {
    byteOffset: number;  // safe-int up to 2^53; 1 TB cap is well within
    byteLen: number;     // u32; per-frame size never exceeds chunkSize+slack
}
```

Notes:

- `globalOffset` is JS `number`. Trajectories are capped at 1 TB by this
  protocol (well within `Number.MAX_SAFE_INTEGER ≈ 9 PB`). The Rust side
  carries `u64` internally; the wasm-bindgen boundary uses `f64` round-trip
  which is exact on safe-int values. If a future format / use case demands
  >1 TB, swap to `bigint` then.
- The deprecated whole-content readers (`LAMMPSReader`, `LAMMPSTrajReader`,
  `XYZReader`, `PDBReader`, `SDFReader`) stay exported with a `@deprecated`
  TSDoc tag through this phase. They get removed once the streaming path
  has shipped and bake-cooked.

### Memory grow rule (callers MUST honor)

`WebAssembly.Memory` may grow on any `wasm-bindgen` call. Growing detaches
all `ArrayBuffer` views. Therefore:

- Pointers returned from `allocInputBuffer`, `columnPtr*`, `gridArrayPtr*`
  are valid only **until the next non-trivial wasm call**.
- The worker MUST re-derive `new Uint8Array(memory.buffer, ptr, len)`
  immediately before each `view.set(bytes)` and immediately before each
  read after a wasm call.
- The reusable `input_buf: Vec<u8>` is allocated in WASM linear memory; its
  pointer is stable as long as no `wasm.allocInputBuffer` resize bumps the
  capacity, but callers should not assume that.

---

## Worker ↔ main protocol

```typescript
// core/src/transport/trajectory_worker/protocol.ts

export type Format =
    | "lammps-dump"
    | "xyz"
    | "pdb"
    | "lammps"
    | "sdf";

export type SourceHandle =
    | { kind: "blob"; blob: Blob /* transferred-by-reference, see note */ }
    | { kind: "opfs"; relativePath: string }; // Phase 4; rejected by MVP

export interface OpenRequest {
    kind: "open";
    requestId: number;
    source: SourceHandle;
    format: Format;
    chunkSize: number; // default 8 MiB
}

export interface IndexProgress {
    kind: "index-progress";
    requestId: number;
    bytesScanned: number;     // safe-int up to 2^53; for >9PB files we'll bigint later
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

export interface LoadFrameRequest {
    kind: "load-frame";
    requestId: number;
    frameId: number;
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

export interface CancelRequest {
    kind: "cancel";
    requestId: number;
    targetRequestId: number;
}

export interface CloseRequest {
    kind: "close";
    requestId: number;
}

export interface BlockPayload {
    name: string;
    columns: ColumnPayload[];
}

export type ColumnPayload =
    | { name: string; dtype: "f64"; data: Float64Array }
    | { name: string; dtype: "u32"; data: Uint32Array }
    | { name: string; dtype: "i32"; data: Int32Array }
    | { name: string; dtype: "string"; data: string[] };

export interface SimboxPayload {
    h: Float64Array;        // length 9
    origin: Float64Array;   // length 3
    pbc: [boolean, boolean, boolean];
}

export interface GridPayload {
    name: string;
    shape: Uint32Array;     // length 3 — [nx, ny, nz]
    origin: Float64Array;   // length 3 — Cartesian origin in Å
    cell: Float64Array;     // length 9 — column-major lattice vectors
    pbc: [boolean, boolean, boolean];
    arrays: { name: string; data: Float64Array }[];
}
```

### Transfer rules

- Every `Float64Array | Uint32Array | Int32Array` in a `FrameMessage` is
  added to the `postMessage` transfer list. Ownership moves to the main
  thread; the worker MUST NOT retain references after `postMessage`.
- The worker copies wasm output into freshly-allocated typed arrays before
  enqueueing them for transfer. This is **required** because `wasm.memory.buffer`
  can detach on the next parse and the next parse can also overwrite the
  same bytes.
- `Blob` is structured-cloneable; `BlobRangeSource` stores it as a `Blob`
  field which postMessage clones by reference (same underlying byte source,
  no copy). OPFS handles in Phase 4 are also structured-cloneable.

### `requestId` correlation

- All requests carry a monotonically increasing `requestId` chosen by the
  main thread. The worker echoes it on every reply.
- For `load-frame`, the runtime keeps a `Map<requestId, { resolve, reject }>`.
  Late replies after a `cancel` are discarded by the main thread (resolver
  already rejected with `CancellationError`).
- A single `open` is in-flight per worker. Subsequent `open` requests reject.

### Indexing pass — blocking

The worker, after `open`:

1. Calls `source.size()` to get `totalBytes`.
2. Loops:
   - Allocate WASM input buffer of size `min(remaining, chunkSize)`.
   - Read the source chunk into the buffer (`source.readRange` for blob,
     direct sync into wasm memory for OPFS Phase 4).
   - Call `feedIndexChunk(globalOffset, len)` and append entries to the
     in-worker `FrameIndexEntry[]`.
   - Every `~50ms` (throttled), `postMessage` an `index-progress` event.
3. On EOF, call `finishIndex()` and `postMessage` `index-ready`.

The runtime translates `index-progress` into `status-message` events on the
main-thread `EventEmitter`:

```
status-message: { type: "info", text: "Indexing trajectory… 12 437 frames" }
```

The runtime suppresses individual progress bursts (max 10 Hz) and emits the
final `index-ready` as a one-line `status-message: "Indexed 14 002 frames"`.

### Cancel semantics

- `cancel` against `targetRequestId == openRequestId` aborts the indexing
  pass. The worker stops chunk reads, drops its partial index, posts
  `open-error: "cancelled"` and remains alive to accept a fresh `open`.
- `cancel` against a `load-frame` request: worker stops at next chunk
  boundary if not yet started parsing, otherwise lets the parse complete
  and discards the result. Either way, no `frame` message for that ID.
- `close` terminates the worker. Runtime `dispose()` calls `close` then
  `worker.terminate()` after a 1 s grace.

---

## Main-thread Frame reconstitution

```typescript
// core/src/transport/trajectory_worker/frame_codec.ts

import { Frame, Box, Grid } from "@molcrafts/molrs";
import type { FrameMessage } from "./protocol";

/** Build a real molrs Frame from a worker payload. The Frame owns its
 *  WASM memory and follows the same lifecycle as any other Frame in
 *  the system (free() on dispose, etc.). */
export function rehydrateFrame(msg: FrameMessage): Frame {
    const frame = new Frame();

    for (const block of msg.blocks) {
        // NOTE: molrs-wasm exposes this as `createBlock`. We may rename
        // it to `addBlock` in a follow-up molrs PR (user preference); the
        // streaming work uses the existing name for now.
        const handle = frame.createBlock(block.name);
        for (const col of block.columns) {
            switch (col.dtype) {
                case "f64": handle.setColF(col.name, col.data); break;
                case "u32": handle.setColU32(col.name, col.data); break;
                case "i32": handle.setColI32(col.name, col.data); break;
                case "string": handle.setColStr(col.name, col.data); break;
            }
        }
    }

    if (msg.simbox) {
        frame.simbox = new Box(
            msg.simbox.h,
            msg.simbox.origin,
            msg.simbox.pbc[0],
            msg.simbox.pbc[1],
            msg.simbox.pbc[2],
        );
    }

    for (const grid of msg.grids) {
        // Grid construction is heavier than just "shape" — molrs-wasm wants
        // dim_x/y/z + origin (Float64[3]) + cell (Float64[9]) + pbc flags.
        // The worker therefore must also emit cell + origin + pbc per grid.
        // (See updated GridPayload below.)
        const g = new Grid(
            grid.shape[0], grid.shape[1], grid.shape[2],
            grid.origin, grid.cell,
            grid.pbc[0], grid.pbc[1], grid.pbc[2],
        );
        for (const a of grid.arrays) g.insertArray(a.name, a.data);
        frame.insertGrid(grid.name, g);
    }

    return frame;
}
```

This is the only place in the codebase where `Frame`, `Box`, and `Grid` are
constructed from typed arrays. Everywhere else, code receives a fully-formed
`Frame` and reads it via the existing `getBlock` / `simbox` / `getGrid` API.

### Lifecycle / `free()`

Each `rehydrateFrame` call creates a new `Frame`. The `Trajectory`'s LRU
cache (size = 16 by default, same as today) calls `frame.free()` on
eviction. The cache itself remains in the runtime (main-thread side), not
in the worker — the worker keeps zero frame memory between `load-frame`
calls (its `output: Option<Frame>` is dropped on `releaseFrame`).

---

## `Trajectory.fromAsyncProvider` + `System.seekFrame`

### `Trajectory` extension

```typescript
// core/src/system/trajectory.ts

export interface AsyncFrameProvider {
    readonly length: number;
    get(index: number): Promise<Frame>;
    dispose?(): void;
}

export class Trajectory {
    private _asyncProvider?: AsyncFrameProvider;
    // ... existing fields ...

    static fromAsyncProvider(
        provider: AsyncFrameProvider,
        boxes: (Box | undefined)[] = [],
    ): Trajectory { /* ... */ }

    /** Async accessor used by System.seekFrame. */
    async frame(index: number): Promise<Frame> {
        if (this._asyncProvider) return this._asyncProvider.get(index);
        // fall through to existing sync paths
        const f = this._getFrame(index);
        return f;
    }
}
```

The existing sync `currentFrame`/`get(i)` accessors stay for backwards
compatibility. They throw if called against an async-only trajectory and
the requested index is not in the LRU cache.

### `System` extension

```typescript
class System {
    private _currentFrame: Frame = new Frame(); // empty placeholder
    private _currentIndex = 0;
    private _activeLoad?: { requestId: number; cancel: () => void };

    /** Sync getter — unchanged for all consumers. Returns the
     *  most-recently-completed seek's frame. */
    get frame(): Frame { return this._currentFrame; }

    /** Async seek. Idempotent w.r.t. _currentIndex; cancels any in-flight
     *  load against a different index. */
    async seekFrame(index: number): Promise<void> {
        if (index === this._currentIndex && !this._activeLoad) return;
        this._activeLoad?.cancel();

        const requestId = nextRequestId();
        const cancel = () => this._trajectory.cancel(requestId);
        this._activeLoad = { requestId, cancel };

        this.events.emit("frame-load-start", { frameId: index, requestId });
        try {
            const frame = await this._trajectory.frame(index);
            if (this._activeLoad?.requestId !== requestId) {
                // a newer seek superseded us; throw away this frame
                frame.free();
                return;
            }
            this._currentFrame = frame;
            this._currentIndex = index;
            this.events.emit("frame-change", { frame, index });
            this.events.emit("frame-load-end",
                { frameId: index, requestId, success: true });
        } catch (err) {
            this.events.emit("frame-load-end",
                { frameId: index, requestId, success: false });
            throw err;
        } finally {
            if (this._activeLoad?.requestId === requestId) {
                this._activeLoad = undefined;
            }
        }
    }
}
```

`seekFrame` is the only writer of `_currentFrame`. All read-side consumers
(`Artist`, modifiers, `UpdateFrameCommand`, `ViewMode`, etc.) keep using the
sync `system.frame` getter — their code is unchanged.

### Race protection

When the user scrubs the timeline rapidly:

- Each `seekFrame(i)` cancels the previous in-flight load.
- If the previous worker reply arrives after cancellation, its `frame` is
  freed and dropped — we already moved on to a newer index.
- The worker honors the cancel by not parsing if it hasn't started, or by
  parsing then dropping the result.

The runtime caches recently-loaded frames (LRU size 16 by default) so
back-and-forth scrubbing inside the cache window costs zero worker round
trips and zero parses.

---

## Auto-detecting modifiers (replaces `decorateFrame`)

`core/src/io/loadFileContent` previously called `decorateFrame` to attach
the PDB backbone. After this spec, that side-effect is gone. Replacement
flow:

1. `loadFileContent` sets up the streaming runtime, awaits `index-ready`,
   awaits `runtime.frame(0)` (the first frame).
2. The pipeline already has `DataSourceModifier` at head (same as today).
3. New step: `await applyAutoDetect(app, frame0)`. This walks a registry of
   `AutoDetectModifier` factories:

```typescript
interface AutoDetectModifier {
    /** Stable identifier for de-dup (e.g. "backbone-ribbon"). */
    id: string;
    /** Cheap predicate against frame 0. Must NOT mutate. */
    matches(frame: Frame): boolean;
    /** Construct the modifier instance to insert. Called once per
     *  trajectory if matches() returned true and the user hasn't
     *  blacklisted this id. */
    create(): Modifier;
}
```

Initial registry (this spec ships only the first; others are placeholders
referenced by Task #12):

- `BackboneRibbonModifier` — `matches`: `frame.getBlock("atoms")?.hasColumn("name") && hasColumn("resname") && hasColumn("resseq")`. `create`: returns the modifier whose `apply(frame)` runs the same backbone walk
  `writeBackboneBlock` does today, but operating on the frame's atoms
  block (not on raw text). The pipeline stage produces a `residues` block
  which the existing ribbon renderer already consumes.

`writeBackboneBlock` (current implementation) reads PDB text. The new
`BackboneRibbonModifier.apply` instead reads the atoms block columns. This
is a strict improvement — it works for any frame with PDB-shaped columns,
not only frames whose original source is a PDB file.

### User-side controls

- The auto-attached modifier is visible in the pipeline panel like any
  manually-added modifier.
- Removing it removes the `residues` block on next pipeline run; the ribbon
  renderer no-ops when the block is absent.
- Per-trajectory state: if the user removes an auto-attached modifier, the
  loader must not re-add it on the next pipeline rebuild. Track this on the
  `Trajectory` (a `Set<string>` of suppressed auto-modifier ids). Cleared
  on trajectory dispose.

### Detailed implementation: defer to Task #12

The auto-detect framework + `BackboneRibbonModifier` itself are not part
of the streaming-trajectory implementation. They land separately (Task
#12) and must merge before Task #6 (worker integration) so the loader has
no `decorateFrame` call.

---

## File-format detection

Currently `inferFormatFromFilename` runs on the page side and dispatches by
extension. With streaming this stays unchanged: format inference is by
extension at load time, format then drives which `WasmTrajStream` class to
instantiate inside the worker. No content sniffing in this phase.

If extension inference fails, the existing `useFormatPicker` UI prompts the
user, same as today.

---

## Acceptance criteria

### Trait + format implementations (Task #3)

For each of the five formats, a Rust integration test:

1. Materialize the same fixture in three feed regimes — single-shot
   (whole file in one `feed`), 1 KB chunks, 64 KB chunks.
2. Compare the resulting `FrameIndexEntry[]` byte-for-byte against the
   single-shot index.
3. For each frame index entry, call `parse_frame_bytes(slice)` and assert
   the resulting `Frame`'s atoms block columns match the legacy
   `read_step(i)` output of the existing reader.

Edge cases per format (LAMMPS dump):

- File with `ITEM: UNITS` before `ITEM: TIMESTEP`.
- File with no trailing newline.
- File with `\r\n` line endings.
- File with a single frame.

### WASM exposure (Task #4)

- `wasm-pack build --release --target bundler --scope molcrafts` succeeds.
- Generated `molrs.d.ts` includes the five new classes with the methods
  documented above.
- A TS test in `molrs-wasm/tests/` (or an equivalent integration test in
  `core/tests/`) instantiates `WasmLammpsDumpStream`, feeds the
  `polymer.lammpstrj` fixture in 4 KB chunks, parses every frame, asserts
  per-column equality against the legacy `LAMMPSTrajReader.read(i)`.

### `BlobRangeSource` + worker (Tasks #5, #6)

- `BlobRangeSource(file).readRange(0, 1024)` returns the same bytes as
  `await new Uint8Array(await file.slice(0, 1024).arrayBuffer())`.
- A Worker-isolated test in `core/tests/transport/trajectory_worker.test.ts`:
  1. Build a `Blob` from the polymer fixture in-test.
  2. Spawn `TrajectoryRuntime`.
  3. `await runtime.indexReady`.
  4. Assert `runtime.length === 11` (or whatever the fixture has).
  5. Load every frame; for each, assert `frame.getBlock("atoms").nrows()`
     and a sample column match the legacy reader.
- Cancel test: load frame 0, immediately call `seekFrame(10)`. Assert
  exactly one `frame-change` event for frame 10 fires.

### `System.seekFrame` async (Task #7)

- `npm run typecheck` clean.
- `npm run test:core` passes.
- New test: `seekFrame(0); seekFrame(10); seekFrame(0)` resolves with the
  cache hit (no new worker `load-frame` for the second call to 0).

### Page integration (Task #8)

- `dev:page` loads `polymer.lammpstrj` (a 11-frame fixture) via the
  streaming runtime.
- The DataSource panel shows `Indexing trajectory… N frames` during the
  index pass and clears it after `index-ready`.
- Timeline scrub triggers `frame-load-start/end` events; rapid scrub is
  smooth (no UI lockup, cancellations evident in console).

---

## Non-goals (explicit)

- This spec is not a performance spec. Streaming **enables** larger files;
  it does not target a specific frame-rate or parse-rate. Performance
  tuning (input-buffer sizing, prefetch, parallel worker pool, OPFS
  caching) is Phase 4 and beyond.
- This spec is not a multi-trajectory architecture spec. Today MolVis hosts
  exactly one `Trajectory` per `MolvisApp` instance. That stays true; this
  spec does not change ownership.
- This spec does not address compressed inputs (`.gz`, `.bz2`). A
  `DecompressedBlobRangeSource` could later wrap a regular source and
  decompress chunks on the fly — out of scope here.

---

## Resolved (review pass)

1. **Grid construction** — verified against `molrs.d.ts`. The molrs-wasm
   `Grid` constructor takes
   `(dim_x, dim_y, dim_z, origin: Float64Array, cell: Float64Array, pbc_x, pbc_y, pbc_z)`,
   not just shape. The streaming protocol's `GridPayload` therefore carries
   shape + origin + cell + pbc in addition to the named arrays. The
   `WasmTrajStream` API exposes `gridOrigin / gridCell / gridPbc` accessors
   alongside `gridShape`. `Grid.insertArray(name, Float64Array)` exists.
2. **`createBlock` vs `addBlock`** — the existing molrs-wasm method is
   `Frame.createBlock(key)`. The user prefers the name `addBlock`; the
   streaming spec uses `createBlock` to avoid blocking on a molrs API
   rename. A future small molrs-wasm PR can rename it (and add
   `addBlock` as a deprecated alias for one release).
3. **String-column transfer cost** — accepted as MVP cost. `string[]` is
   structured-cloned across postMessage, not transferred. If profiling
   shows it dominates for PDB / SDF, swap to flat UTF-8 + offset-table
   encoding (transferable `Uint8Array`).
4. **VSCode extension CSP** — flagged for verification at Task #8 time.
   rsbuild's `new Worker(new URL(…))` pattern produces blob-URL workers in
   dev and self-hosted in prod; the vsc-ext webview HTML may need
   `worker-src 'self' blob:` added to CSP. Verified during integration,
   not blocking design.
5. **`requestId` / offset typing** — both are JS `number` (safe-int up to
   2^53). The protocol caps trajectory size at 1 TB and request count at
   ~9e15, both well inside safe-int. `bigint` only re-emerges if a future
   spec lifts the 1 TB cap.

---

## Phase boundaries (cross-reference to task list)

| Phase | Tasks | What ships |
|-------|-------|-----------|
| 1.0 spec | #2 (this) | this document, signed off |
| 1 | #3, #4 | molrs-io trait + 5 impls; molrs-wasm 5 streaming classes |
| 2a | #5 | `TrajectorySource` interface + `BlobRangeSource` |
| 2b | #6 | Worker, runtime, frame codec, async `Trajectory.fromAsyncProvider` |
| 2c | #7 | `System.seekFrame` async, sync `System.frame` cache, race protection |
| auto-modifier | #12 | `decorateFrame` removed, `BackboneRibbonModifier` auto-attaches |
| 3 | #8 | `DataSourceModifier` switches to streaming runtime; status bar; cancel UI |
| 4 | #9, #10 | OPFS binary cache + `OPFSSyncRangeSource` |
| 5 | #11 | optional `.molidx` sidecar |

End-to-end success — the polymer.lammpstrj fixture loads via streaming and
plays back without regression — is reached at the end of Phase 3 (Task #8).
Phase 4 / 5 are pure performance and persistence wins on top.
