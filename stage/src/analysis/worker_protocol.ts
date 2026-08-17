/**
 * Analysis workload job / result / progress shapes.
 *
 * Wire envelope lives in `@molcrafts/molvis-core/workload`; the compute job
 * kind that carries these lives in `../compute/protocol`. This module owns the
 * analysis wire vocabulary only — no molrs handle ever crosses it.
 *
 * "molrs" is the Rust/WebAssembly molecular core this package computes with,
 * reached through `@molcrafts/molvis-core/molrs`. Its objects (`Frame`, `Box`,
 * `Block`) are handles into WebAssembly memory, and a handle is meaningless in
 * another thread — hence this module: every shape here is plain JavaScript data
 * that `postMessage` can clone or transfer, and the worker rebuilds its own
 * molrs objects from it.
 */

import type { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { CELL_TILT_EPS, lammpsCellFromBox } from "../io/box_lammps";
import { DType } from "../utils/dtype";
import type {
  AnalysisDefinition,
  AnalysisInputKind,
  AnalysisRequirement,
} from "./registry";
import {
  type AnalysisTrajectorySource,
  expandFrameRange,
  type FrameRange,
} from "./trajectory_runner";

export { CELL_TILT_EPS };

/**
 * One trajectory frame as plain data for a cross-thread analysis job.
 *
 * Coordinates are one array per axis, in Å, all of length `nAtoms`; `elements`
 * is parallel to them. Everything here survives `structuredClone`, so the
 * worker rebuilds its own molrs `Frame` and neither side shares a handle.
 */
export interface AnalysisFrameSnapshot {
  /**
   * Index of this frame in the source trajectory — echoed in progress beats
   * and in {@link AnalysisJobResult.framesVisited}, so a strided or sparse
   * frame range stays addressable in the caller's own numbering.
   */
  frameIndex: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Element symbol per atom, same order and length as `x` / `y` / `z`. */
  elements: string[];
  /**
   * The canonical `id` column when the frame carries one, used to track the
   * same atoms across frames — mean squared displacement (MSD: how far atoms
   * have moved from a reference frame) and friends — instead of trusting row
   * order.
   *
   * `Uint32Array` is the only dtype needed: molrs binds `id` to `UInt` in its
   * column schema and refuses a signed or float column under that key, so a
   * frame's `Block.dtype("id")` is `u32` or the column is absent.
   */
  ids?: Uint32Array;
  /**
   * The LAMMPS (Large-scale Atomic/Molecular Massively Parallel Simulator) cell diagonal `[lx, ly, lz]` (Å) of the simulation cell — the
   * periodically repeating box the frame's atoms live in.
   *
   * Present whenever the source frame carries a cell (`frame.box`), absent
   * otherwise; a snapshot without it makes the worker run free boundary, i.e.
   * with no periodic images of the atoms. Same rule as the main-thread path
   * (`frameHasBox` in `./rdf_params`), so worker and main thread agree frame by
   * frame.
   *
   * The diagonal, **not** the lattice-vector norms molrs `Box.lengths()`
   * reports: once the cell tilts, `|b| > ly`. Paired with {@link boxTilts},
   * `hMatrixFromLammps(boxLengths, boxTilts)` (`pipeline/draw_box.ts`) rebuilds
   * the source cell exactly.
   */
  boxLengths?: Float64Array;
  /** Cell origin `[ox, oy, oz]` (Å); `[0, 0, 0]` when omitted. */
  boxOrigin?: Float64Array;
  /**
   * LAMMPS tilt factors `[xy, xz, yz]` (Å) of a triclinic cell, i.e. the
   * off-diagonal entries of the h matrix whose diagonal is {@link boxLengths}.
   *
   * Absent for an orthorhombic cell — one whose three edges meet at right
   * angles, so all tilts are within {@link CELL_TILT_EPS} — and the worker then
   * rebuilds `Box.ortho` rather than reading a zero triple. A *triclinic* cell
   * (edges not at right angles) is carried, not converted: the molrs kernels
   * handle tilt directly, so the tilted cell travels as-is instead of being
   * approximated by a right-angled box or rejected.
   */
  boxTilts?: Float64Array;
}

/**
 * One analysis to run on the worker: which analysis, with what settings, over
 * which frames.
 *
 * `frames` is already the resolved frame range — the worker does no frame
 * selection of its own and visits exactly these snapshots, in order.
 */
export interface AnalysisJobPayload {
  /** Catalog / registry key of the analysis (`AnalysisDefinition.id`). */
  analysisId: string;
  /**
   * Analysis parameters keyed by param name.
   *
   * Plain structured-cloneable data only (numbers, booleans, strings and
   * arrays of those) — the values come from panel state and cross the worker
   * boundary untouched. No class instances, no functions, no molrs handles.
   */
  params: Record<string, unknown>;
  /**
   * The frames to visit, in visit order. Their {@link
   * AnalysisFrameSnapshot.frameIndex} values are the caller's own numbering and
   * need not be contiguous (a strided range is fine).
   */
  frames: AnalysisFrameSnapshot[];
}

/**
 * What the worker sends back for one analysis job.
 *
 * A cancelled job still answers `done`: `cancelled` is `true`, `payload` is
 * `null`, and `framesVisited` reports how far the run got. `payload` is
 * `unknown` because its shape belongs to the analysis (`AnalysisResultKind`),
 * not to this envelope — the caller narrows it by `analysisId`.
 */
export interface AnalysisJobResult {
  /** Echo of {@link AnalysisJobPayload.analysisId}. */
  analysisId: string;
  /** True when the run stopped early because the host asked it to. */
  cancelled: boolean;
  /**
   * The analysis result, or `null` when `cancelled` is true.
   *
   * A job that finishes normally never answers `null`: a run that produced
   * nothing (too few frames or atoms) fails with an error instead, so
   * `cancelled === false` means `payload` is a real result.
   */
  payload: unknown;
  /** Source frame indices actually visited, in visit order. */
  framesVisited: number[];
}

/**
 * What a shape-dispatched analysis answers as {@link AnalysisJobResult.payload}.
 *
 * The envelope catalog-shape dispatch fills in (`./job_runner`), as opposed to
 * the two trajectory-level entries — the radial distribution function (RDF: how
 * atom density varies with distance from an atom) and MSD — whose payload is
 * their own result type. Not to be confused with `AnalysisRunResult`
 * (`./dispatch`), the main-thread envelope: that one carries the tracked
 * selection and real `Error` objects, and neither belongs on a wire.
 *
 * Frame indices are the caller's own numbering — the {@link
 * AnalysisFrameSnapshot.frameIndex} values of the job's frames — the same
 * numbering progress beats and {@link AnalysisJobResult.framesVisited} use.
 */
export interface AnalysisShapeResult {
  /** Frames that produced a value, in visit order. */
  frameIndices: number[];
  /**
   * True when {@link value} is one entry per frame, false when it is a single
   * accumulated payload for the whole range.
   */
  perFrame: boolean;
  /**
   * Frames that failed on their own; the run went on past each of them.
   *
   * Plain `{ frameIndex, message }`, deliberately **not** the main thread's
   * `AnalysisFrameFailure`: an `Error` survives `postMessage` structurally but
   * loses its prototype, so an `AnalysisUnsupportedError` would arrive as a bare
   * `Error` and every later `instanceof` on it would answer the wrong thing. The
   * frame and the message are what a panel shows anyway.
   */
  failures: Array<{ frameIndex: number; message: string }>;
  /**
   * The analysis payload: `Array<{ frameIndex, value }>` when {@link perFrame},
   * otherwise the accumulator's single result. `unknown` because the shape
   * belongs to the analysis (`AnalysisResultKind`), not to this envelope.
   */
  value: unknown;
}

/**
 * Everything a caller can be told about one analysis job before it finishes.
 *
 * Only the `frame` beats come from the worker. The single `status` line is
 * synthesized on the main thread while the worker is still booting — the job
 * itself never reports a phase.
 */
export type AnalysisJobProgress =
  | {
      kind: "status";
      /**
       * Setup status line, today only the boot beat's `Starting compute worker…`
       * from `../compute/runtime`. A warm worker produces none.
       */
      message: string;
    }
  | {
      kind: "frame";
      /**
       * Frames attempted so far, out of `total`. One beat per frame the run
       * reached, a frame whose own analysis failed included, so `completed`
       * always advances and never runs past `total`.
       */
      completed: number;
      /** Frames in this job, i.e. `AnalysisJobPayload.frames.length`. */
      total: number;
      /** Source trajectory index of the frame just finished. */
      frameIndex: number;
    };

/**
 * Owned copy of one coordinate column.
 *
 * `copyColF` already returns a JS-heap copy (never a view into WASM memory),
 * so the buffer is safe both to keep and to transfer.
 */
function copyCoordColumn(
  atoms: Block,
  key: string,
  frameIndex: number,
): Float64Array {
  if (atoms.dtype(key) === undefined) {
    throw new Error(
      `Analysis snapshot: frame ${frameIndex} has no "${key}" column`,
    );
  }
  return atoms.copyColF(key);
}

/**
 * The canonical `id` column when the frame carries one.
 *
 * molrs binds `id` to `UInt`, so a present column is `u32` — a differently
 * typed `id` is a real schema break and says so instead of being dropped.
 */
function copyIdColumn(
  atoms: Block,
  frameIndex: number,
): Uint32Array | undefined {
  const dtype = atoms.dtype("id");
  if (dtype === undefined) return undefined;
  if (dtype !== DType.U32) {
    throw new Error(
      `Analysis snapshot: frame ${frameIndex} has an "id" column of dtype ` +
        `${dtype}; molrs binds "id" to u32`,
    );
  }
  return atoms.copyColU32("id");
}

/** A cell as the LAMMPS `lx ly lz` / `xy xz yz` pair plus its origin (Å). */
interface SnapshotCell {
  boxLengths: Float64Array;
  boxOrigin: Float64Array;
  /** Absent for an orthorhombic cell — see {@link AnalysisFrameSnapshot}. */
  boxTilts?: Float64Array;
}

/**
 * Read the cell as the LAMMPS diagonal + tilts + origin.
 *
 * See {@link lammpsCellFromBox}: a tilted cell must not forward
 * `box.lengths()` (vector norms). Orthorhombic snapshots omit tilts.
 */
function describeSnapshotCell(box: Box): SnapshotCell {
  const cell = lammpsCellFromBox(box);
  const tilted = cell.tilts.some((value) => Math.abs(value) > CELL_TILT_EPS);
  return {
    boxLengths: Float64Array.from(cell.lengths),
    boxOrigin: Float64Array.from(cell.origin),
    boxTilts: tilted ? Float64Array.from(cell.tilts) : undefined,
  };
}

/**
 * Pack one molrs frame into a handle-free snapshot for a worker job.
 *
 * Main-thread side: copies the frame's coordinate / element / `id` columns and,
 * when the frame has one, its cell. A tilted (triclinic) cell is carried as the
 * LAMMPS diagonal plus tilt factors — see {@link AnalysisFrameSnapshot.boxTilts}
 * — never approximated by a right-angled box. A frame with no cell yields a
 * snapshot with no cell, which the worker runs at free boundary.
 *
 * The frame itself is only read: `getBlock` and `box` hand back borrows of the
 * frame's own WebAssembly memory, so nothing here is freed and the caller keeps
 * owning the frame. Every array in the returned snapshot is a fresh JavaScript
 * copy, which is what makes it safe to hand to
 * {@link analysisJobTransferList} and transfer away.
 *
 * @param frame source frame, still owned by its trajectory
 * @param frameIndex index to record as {@link AnalysisFrameSnapshot.frameIndex}
 *   — the caller's own numbering, echoed in progress beats and `framesVisited`
 * @returns a plain-data snapshot, all lengths in Å
 * @throws Error when the frame has no `atoms` block, when it lacks a string
 *   `element` column, when a coordinate column (`x` / `y` / `z`) is missing, or
 *   when it carries an `id` column that is not `u32` (a real schema break —
 *   molrs binds `id` to unsigned int)
 */
export function snapshotFrameForAnalysis(
  frame: Frame,
  frameIndex: number,
): AnalysisFrameSnapshot {
  const atoms = frame.getBlock("atoms");
  if (!atoms) {
    throw new Error(`Analysis snapshot: frame ${frameIndex} has no atoms`);
  }
  // `getBlock` / `box` hand back borrows of the frame's own data — reading them
  // is safe, freeing them would corrupt the frame.
  const elementDtype = atoms.dtype("element");
  if (elementDtype !== DType.String) {
    throw new Error(
      `Analysis snapshot: frame ${frameIndex} needs a string "element" column ` +
        `(got ${elementDtype ?? "no column"})`,
    );
  }
  // Checked above: `copyColStr` is typed loosely by wasm-bindgen, and the dtype
  // is what makes this a `string[]`.
  const elements: string[] = atoms.copyColStr("element");
  const box = frame.box;
  const cell = box ? describeSnapshotCell(box) : undefined;

  return {
    frameIndex,
    x: copyCoordColumn(atoms, "x", frameIndex),
    y: copyCoordColumn(atoms, "y", frameIndex),
    z: copyCoordColumn(atoms, "z", frameIndex),
    elements,
    ids: copyIdColumn(atoms, frameIndex),
    boxLengths: cell?.boxLengths,
    boxOrigin: cell?.boxOrigin,
    boxTilts: cell?.boxTilts,
  };
}

/**
 * Pack a frame range of a trajectory into the handle-free snapshots one worker
 * job carries.
 *
 * The range version of {@link snapshotFrameForAnalysis}: it expands the range
 * with {@link expandFrameRange} — the same clamping `runTrajectoryFrames` and
 * the worker's own runner use, so a job visits exactly the frames a main-thread
 * run would — reads each frame from the trajectory, and snapshots it. Every
 * column rule (which columns are required, how the cell is carried, what an
 * `id` column must be) lives in the single-frame function alone; nothing is
 * re-decided here. Frames are read one at a time rather than all at once, so a
 * trajectory that still has to decode or fetch a frame is asked for one frame
 * at a time, as the main-thread walk asks.
 *
 * **The frames belong to the trajectory.** They are read and copied, never
 * freed: molrs frames are handles into WebAssembly memory, and freeing one the
 * trajectory still owns corrupts every later read of it (see
 * {@link AnalysisTrajectorySource.frame}). Conversely, every array in the
 * returned snapshots is a fresh JavaScript copy that shares nothing with the
 * source frames, which is what makes the batch safe to hand straight to
 * {@link analysisJobTransferList} and transfer away — as
 * {@link AnalysisJobPayload.frames}.
 *
 * An empty result is not an error here: whether "no frames" or "too few frames"
 * is a problem — and what to tell the user about it — belongs to the caller
 * (the radial-distribution panel needs one frame with atom pairs, an MSD run
 * needs two), so an empty trajectory, an empty range, or a range that starts
 * past its end all answer `[]` quietly.
 *
 * @param trajectory where the frames come from; any
 *   {@link AnalysisTrajectorySource}, so the live stage trajectory and a
 *   worker-side source both serve. It keeps owning every frame it hands out.
 * @param frameRange frames to pack, in visit order. Defaults to the whole
 *   trajectory, stride 1; out-of-range bounds are clamped, not rejected.
 * @returns one snapshot per visited frame, in visit order, each carrying the
 *   frame's own trajectory index as {@link AnalysisFrameSnapshot.frameIndex} —
 *   the caller's numbering that progress beats and
 *   {@link AnalysisJobResult.framesVisited} report against, so a strided range
 *   stays addressable instead of being renumbered `0 … n-1`
 * @throws Error from {@link snapshotFrameForAnalysis} for the first frame that
 *   cannot be snapshotted, naming that frame — a schema break is a fact about
 *   the trajectory, so the whole job fails rather than silently shipping a
 *   shorter range than the caller asked for
 * @example
 * ```ts
 * const frames = await snapshotFramesForAnalysis(app.system.trajectory, {
 *   start: 0,
 *   endInclusive: 99,
 *   stride: 10,
 * });
 * // → snapshots for frames 0, 10, … 90; the trajectory still owns its frames.
 * if (frames.length === 0) return "Load a trajectory first.";
 * ```
 */
export async function snapshotFramesForAnalysis(
  trajectory: AnalysisTrajectorySource,
  frameRange?: FrameRange,
): Promise<AnalysisFrameSnapshot[]> {
  const snapshots: AnalysisFrameSnapshot[] = [];
  for (const frameIndex of expandFrameRange(trajectory.length, frameRange)) {
    // Borrowed, not taken: snapshot the frame and leave it to the trajectory.
    const frame = await trajectory.frame(frameIndex);
    snapshots.push(snapshotFrameForAnalysis(frame, frameIndex));
  }
  return snapshots;
}

// ---------------------------------------------------------------------------
// What a snapshot can express
// ---------------------------------------------------------------------------

/**
 * Input kinds an {@link AnalysisFrameSnapshot} can drive.
 *
 * The per-frame shapes `runSingleFrame` implements (`./shape_dispatch`'s
 * `PER_FRAME_KINDS`) plus `accumulate`, which is fed one frame at a time and is
 * therefore just as expressible. Spelled out here rather than imported: this is
 * the wire tier, and reaching into a molrs-loading kernel module would put molrs
 * behind every importer of this file. A new per-frame shape lands in both.
 *
 * The two absentees are absent on purpose. `series` consumes a per-atom
 * velocity matrix stacked across frames, and the snapshot carries no velocity
 * columns to stack — that is the machine-readable form of "`runSeries` stays on
 * the main thread". `frameGroupSets` needs a per-observable atom-group editor,
 * i.e. UI state rather than frame data.
 */
const SNAPSHOT_INPUT_KINDS: ReadonlySet<AnalysisInputKind> =
  new Set<AnalysisInputKind>([
    "frame",
    "frameNeighbors",
    "frameClusters",
    "frameGroups",
    "frameRadii",
    "accumulate",
  ]);

/**
 * Requirements a job satisfies, today exactly one.
 *
 * `voidMask` is built from the job's own atom selection — a `params` entry that
 * does cross the wire (`AnalysisWireParams.selection` in `./job_runner`) — not
 * from a frame column, so a snapshot expresses it.
 *
 * Every other requirement fails, and the reason is the same one line:
 * {@link snapshotFrameForAnalysis} copies x / y / z, `element`, `id` and the
 * cell, and nothing else.
 * - `velocity`, `charge`, `dipole`, `orientation` — the atom columns
 *   `isFrameColumnRequirement` (`./registry`) names (`vx/vy/vz`, `charge`,
 *   `mux/muy/muz`, `quatw/quati/quatj/quatk`). None is snapshotted.
 * - `atomPairs`, `atomTriples`, `atomQuads`, `atomGroups` — all four are read
 *   off the frame's *bonds* block (`./panel_inputs`), and the snapshot carries
 *   the atoms block alone.
 * - `labels` — an arbitrary per-atom column chosen at run time (`labelBy`),
 *   which is exactly the kind of column the snapshot does not carry.
 * - everything else (`magneticDipole`, `polarizability`, `gTensor`,
 *   `scalarField`, `series`, `xySeries`, `descriptorMatrix`, `donors`,
 *   `acceptors`, `hbondPresence`, `hbondEdges`, `referenceAtoms`,
 *   `targetAtoms`, `template`) is an upstream analysis result or a second
 *   structure, neither of which is frame data at all.
 *
 * Growing this set means growing {@link AnalysisFrameSnapshot} first — a wire
 * change — which is the whole point of writing the two down side by side.
 */
const SNAPSHOT_SATISFIED_REQUIREMENTS: ReadonlySet<AnalysisRequirement> =
  new Set<AnalysisRequirement>(["voidMask"]);

/**
 * Can an {@link AnalysisFrameSnapshot} express what this analysis needs?
 *
 * The other face of {@link snapshotFrameForAnalysis}: that function decides what
 * a snapshot carries, this one decides what that is enough for. They live in one
 * module so there is a single truth about the snapshot's contents.
 *
 * What a snapshot carries is the whole basis of the verdict: per-axis
 * coordinates in Å, one element symbol per atom, the canonical `id` column when
 * the frame has one, the cell when the frame has one — and nothing else. So an
 * analysis is covered when both halves hold. Its `inputKind` — the data shape
 * the analysis's molrs binding consumes — must be one of
 * {@link SNAPSHOT_INPUT_KINDS}, and every entry of its `requires` list must be
 * one of {@link SNAPSHOT_SATISFIED_REQUIREMENTS}, today just `voidMask`, which
 * comes from the job's own selection parameter rather than from a frame column.
 * Those two declarations carry the reason for every kind and every requirement
 * that fails, one by one; `snapshotGap` (`./job_runner`) turns a `false` here
 * into the sentence the refusal quotes, by re-asking this predicate rather than
 * repeating those reasons.
 *
 * **One declaration, two users.** The worker asks it as its admission gate
 * before it dispatches a job (`./job_runner`). The analysis panel's run router
 * — worker thread or main thread, the next step of this chain — asks this same
 * function instead of restating the coverage rules on the page side. Two copies
 * of those rules would drift into "the panel submitted a job the worker
 * refuses", which is the state this one declaration exists to make unreachable.
 *
 * @param definition the catalog entry to judge — only its `inputKind` and
 *   `requires` are read, so a hand-written literal answers as well as a catalog
 *   lookup
 * @returns true when the analysis can run from snapshots alone
 * @example
 * ```ts
 * // `entry` is any catalog entry — `getAnalysisDefinition(id)` (`./registry`).
 * // Positions are all this one needs, so it may be offloaded to the worker.
 * snapshotCoversAnalysis({ ...entry, inputKind: "frame", requires: [] });
 * // → true
 *
 * // Velocity columns are not snapshotted, so this one stays on the main
 * // thread; a job submitted anyway is refused with that reason named.
 * snapshotCoversAnalysis({
 *   ...entry,
 *   inputKind: "frame",
 *   requires: ["velocity"],
 * });
 * // → false
 * ```
 */
export function snapshotCoversAnalysis(
  definition: AnalysisDefinition,
): boolean {
  if (!SNAPSHOT_INPUT_KINDS.has(definition.inputKind)) return false;
  return definition.requires.every((requirement) =>
    SNAPSHOT_SATISFIED_REQUIREMENTS.has(requirement),
  );
}

/**
 * Every buffer in an analysis job payload, as the transfer list for
 * `postMessage`.
 *
 * Posting with this list moves the buffers to the worker and detaches them
 * here, which is why a payload must not be reused or read after the job is
 * sent. `runAnalysisOnWorker` (`./worker_client`) passes this list for you —
 * call it directly only when posting a job by hand.
 */
export function analysisJobTransferList(
  job: AnalysisJobPayload,
): Transferable[] {
  const list: Transferable[] = [];
  for (const frame of job.frames) {
    list.push(frame.x.buffer, frame.y.buffer, frame.z.buffer);
    if (frame.ids) list.push(frame.ids.buffer);
    if (frame.boxLengths) list.push(frame.boxLengths.buffer);
    if (frame.boxOrigin) list.push(frame.boxOrigin.buffer);
    if (frame.boxTilts) list.push(frame.boxTilts.buffer);
  }
  return list;
}
