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
   * same atoms across frames (MSD and friends) instead of trusting row order.
   *
   * `Uint32Array` is the only dtype needed: molrs binds `id` to `UInt` in its
   * column schema and refuses a signed or float column under that key, so a
   * frame's `Block.dtype("id")` is `u32` or the column is absent.
   */
  ids?: Uint32Array;
  /**
   * The LAMMPS cell diagonal `[lx, ly, lz]` (Å) of the simulation cell — the
   * periodically repeating box the frame's atoms live in.
   *
   * Present whenever the source frame carries a cell (`frame.box`), absent
   * otherwise; a snapshot without it makes the worker run free boundary, i.e.
   * with no periodic images of the atoms. Same rule as the main-thread path
   * (`frameHasBox` in `./rdf`), so worker and main thread agree frame by frame.
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
