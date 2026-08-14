import type { Frame } from "@molcrafts/molvis-core/molrs";
import type { SelectionMask } from "../pipeline/types";
import type { Trajectory } from "../system/trajectory";
import { type ColumnDType, DType } from "../utils/dtype";
import { yieldToUi } from "../utils/yield_ui";

/**
 * Which frames of a trajectory an analysis should visit.
 *
 * Both bounds are frame indices and both are inclusive; `stride` of `n` keeps
 * every n-th frame from `start`. Omitted fields mean the whole trajectory,
 * stride 1. Out-of-range bounds are clamped rather than rejected — see
 * {@link expandFrameRange}.
 */
export interface FrameRange {
  start?: number;
  endInclusive?: number;
  stride?: number;
}

export type AnalysisAtomSelection =
  | { kind: "all" }
  | { kind: "indices"; indices: readonly number[] }
  | { kind: "mask"; mask: SelectionMask };

export type AtomTrackingMode = "all" | "id-column" | "row-index";
export type AtomTrackingKey = string | number;

export interface TrackedAtomSelection {
  mode: AtomTrackingMode;
  referenceFrameIndex: number;
  referenceAtomCount: number;
  indices: number[];
  idColumn?: string;
  idDtype?: ColumnDType;
  keys?: AtomTrackingKey[];
  warnings: string[];
}

export interface ResolvedTrackedAtoms {
  ok: boolean;
  atomCount: number;
  indices: number[];
  missing: AtomTrackingKey[];
}

export interface AnalysisFrameFailure {
  frameIndex: number;
  error: Error;
}

/** One beat per frame an analysis finished with, successful or failed. */
export interface AnalysisProgress {
  /** Frames attempted so far, counting this one. */
  completed: number;
  /** Frames in the resolved {@link FrameRange}. */
  total: number;
  /**
   * Index of the frame just finished **within the trajectory source** it was
   * read from. For a worker job that source holds only the job's own snapshots,
   * so the caller maps this back to its own numbering (see `./job_runner`).
   */
  frameIndex: number;
}

/** How to run a multi-frame analysis: which frames, and how to report/stop. */
export interface AnalysisRunOptions {
  /** Frames to visit. Defaults to every frame, stride 1. */
  frameRange?: FrameRange;
  /**
   * Frame whose atoms define the tracked selection. Defaults to the first
   * visited frame, which is also what `computeRdfTrajectory` /
   * `computeMsdTrajectory` (`./trajectory_analyses`) always use — they resolve
   * their reference from the frame range and ignore this field.
   */
  referenceFrameIndex?: number;
  /**
   * Cooperative stop. Checked at each frame boundary; once aborted the analysis
   * throws {@link AnalysisAbortError} instead of returning a partial result, so
   * the caller decides what a cancel means.
   */
  abortSignal?: AbortSignal;
  /** Called after each frame, successful or not. */
  onProgress?: (progress: AnalysisProgress) => void;
  /**
   * Called for a frame that failed on its own. Per-frame failures are collected
   * and reported, not thrown: one bad frame does not lose the whole run.
   */
  onFrameError?: (failure: AnalysisFrameFailure) => void;
  /**
   * What to do when the tracked atoms cannot be found in a frame — record a
   * failure and move on (`"skip-frame"`, the default) or fail the run. Read by
   * {@link runTrajectoryFrames}; the RDF / MSD trajectory helpers always record
   * and move on.
   */
  missingTrackedAtoms?: "skip-frame" | "throw";
}

/**
 * The trajectory surface a multi-frame analysis needs: how many frames there
 * are, and the frame at an index.
 *
 * Structural on purpose. The concrete {@link Trajectory} satisfies it, and so
 * does a worker-side source rebuilt from plain frame snapshots — an analysis
 * kernel never needs the rest of the stage `System` graph to run.
 */
export interface AnalysisTrajectorySource {
  /** Number of frames, so index `0 … length - 1` is addressable. */
  readonly length: number;
  /**
   * The frame at `index`. Async because a real trajectory may still have to
   * decode or fetch it.
   *
   * The frame stays owned by the source — read it, never free it. (molrs frames
   * are handles into WebAssembly memory; freeing one the source still holds
   * would corrupt every later read of it.)
   */
  frame(index: number): Promise<Frame>;
}

export interface TrajectoryFrameContext {
  frame: Frame;
  frameIndex: number;
  ordinal: number;
  total: number;
  trackedSelection?: TrackedAtomSelection;
  atomIndices?: number[];
}

export interface TrajectoryFrameRunOptions {
  trajectory: Trajectory;
  selection?: AnalysisAtomSelection;
  run?: AnalysisRunOptions;
}

export interface TrajectoryFrameRunResult<T> {
  frameIndices: number[];
  results: Array<{ frameIndex: number; value: T }>;
  failures: AnalysisFrameFailure[];
  trackedSelection?: TrackedAtomSelection;
}

/**
 * Thrown by a multi-frame analysis when {@link AnalysisRunOptions.abortSignal}
 * was aborted — the marker a caller catches to report "cancelled" rather than
 * "failed".
 */
export class AnalysisAbortError extends Error {
  constructor() {
    super("Analysis run was aborted");
    this.name = "AnalysisAbortError";
  }
}

/**
 * Raised when the analysis catalog — the list of analyses molrs (the
 * Rust/WebAssembly molecular core) exposes, wrapped by `./registry` — describes
 * something this build cannot drive: an input shape no dispatcher implements, a
 * requirement no trajectory can satisfy, or a result handle that did not arrive
 * in a shape `./result_marshal` can serialize. Carries the analysis id so the
 * caller can name the entry.
 *
 * Lives here, beside {@link AnalysisAbortError}, rather than with the
 * main-thread dispatcher, so that a module which runs wherever an analysis runs
 * — `./result_marshal` today — can raise it without importing main-thread
 * orchestration. `./dispatch` re-exports it under its original name, so its
 * public import path is unchanged.
 */
export class AnalysisUnsupportedError extends Error {
  constructor(
    readonly analysisId: string,
    reason: string,
  ) {
    super(`${analysisId} cannot run: ${reason}`);
    this.name = "AnalysisUnsupportedError";
  }
}

/**
 * The canonical stable atom identifier, per molrs `store::keys::ID`.
 *
 * Format-native spellings are renamed at the reader boundary, so a frame never
 * carries `atom_id` / `atomid`; probing for them would only mask a real gap.
 */
const STABLE_ATOM_ID_COLUMNS = ["id"];

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function expandFrameRange(
  trajectoryLength: number,
  range: FrameRange = {},
): number[] {
  if (trajectoryLength <= 0) return [];
  const last = trajectoryLength - 1;
  const start = clampInt(range.start ?? 0, 0, last);
  const end = clampInt(range.endInclusive ?? last, 0, last);
  const stride = Math.max(1, Math.trunc(range.stride ?? 1));
  if (start > end) return [];

  const out: number[] = [];
  for (let i = start; i <= end; i += stride) out.push(i);
  return out;
}

function getAtomCount(frame: Frame): number {
  return frame.getBlock("atoms")?.nrows() ?? 0;
}

function selectionToIndices(
  frame: Frame,
  selection: AnalysisAtomSelection | undefined,
): number[] {
  const atomCount = getAtomCount(frame);
  if (!selection || selection.kind === "all") {
    return Array.from({ length: atomCount }, (_, i) => i);
  }
  if (selection.kind === "mask") return selection.mask.getIndices();
  return Array.from(new Set(selection.indices)).filter(
    (idx) => Number.isInteger(idx) && idx >= 0 && idx < atomCount,
  );
}

function readAtomKeys(
  frame: Frame,
  column: string,
): { dtype: ColumnDType; values: AtomTrackingKey[] } | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms) return null;
  const dtype = atoms.dtype(column) as ColumnDType | undefined;
  if (!dtype) return null;

  // Only ever called with STABLE_ATOM_ID_COLUMNS ("id"), which molrs pins to
  // u32 — U32-or-absent is exhaustive.
  if (dtype === DType.U32) {
    const values = atoms.copyColU32(column);
    return values ? { dtype, values: Array.from(values) } : null;
  }
  return null;
}

function keyId(key: AtomTrackingKey): string {
  return `${typeof key}:${String(key)}`;
}

function pickStableIdColumn(
  frame: Frame,
  indices: readonly number[],
): { column: string; dtype: ColumnDType; keys: AtomTrackingKey[] } | null {
  for (const column of STABLE_ATOM_ID_COLUMNS) {
    const data = readAtomKeys(frame, column);
    if (!data) continue;
    const keys = indices.map((idx) => data.values[idx]);
    if (keys.some((key) => key === undefined || key === null)) continue;
    const unique = new Set(keys.map(keyId));
    if (unique.size !== keys.length) continue;
    return { column, dtype: data.dtype, keys };
  }
  return null;
}

export function resolveTrackedAtomSelection(
  frame: Frame,
  selection: AnalysisAtomSelection | undefined,
  referenceFrameIndex = 0,
): TrackedAtomSelection {
  const atomCount = getAtomCount(frame);
  const indices = selectionToIndices(frame, selection);
  const warnings: string[] = [];

  if (!selection || selection.kind === "all") {
    return {
      mode: "all",
      referenceFrameIndex,
      referenceAtomCount: atomCount,
      indices,
      warnings,
    };
  }

  const stable = pickStableIdColumn(frame, indices);
  if (stable) {
    return {
      mode: "id-column",
      referenceFrameIndex,
      referenceAtomCount: atomCount,
      indices,
      idColumn: stable.column,
      idDtype: stable.dtype,
      keys: stable.keys,
      warnings,
    };
  }

  warnings.push(
    "No stable atom id column found; tracking selected atoms by first-frame row index.",
  );
  return {
    mode: "row-index",
    referenceFrameIndex,
    referenceAtomCount: atomCount,
    indices,
    warnings,
  };
}

export function resolveTrackedAtomIndices(
  frame: Frame,
  tracked: TrackedAtomSelection,
): ResolvedTrackedAtoms {
  const atomCount = getAtomCount(frame);
  if (tracked.mode === "all") {
    return {
      ok: true,
      atomCount,
      indices: Array.from({ length: atomCount }, (_, i) => i),
      missing: [],
    };
  }

  if (tracked.mode === "row-index") {
    const missing = tracked.indices.filter((idx) => idx >= atomCount);
    const countChanged = atomCount !== tracked.referenceAtomCount;
    return {
      ok: missing.length === 0 && !countChanged,
      atomCount,
      indices: countChanged
        ? []
        : tracked.indices.filter((idx) => idx < atomCount),
      missing: countChanged ? tracked.indices : missing,
    };
  }

  if (!tracked.idColumn || !tracked.keys) {
    return {
      ok: false,
      atomCount,
      indices: [],
      missing: tracked.indices,
    };
  }

  const data = readAtomKeys(frame, tracked.idColumn);
  if (!data) {
    return {
      ok: false,
      atomCount,
      indices: [],
      missing: tracked.keys,
    };
  }

  const indexByKey = new Map<string, number>();
  data.values.forEach((key, idx) => {
    const id = keyId(key);
    if (!indexByKey.has(id)) indexByKey.set(id, idx);
  });

  const indices: number[] = [];
  const missing: AtomTrackingKey[] = [];
  for (const key of tracked.keys) {
    const idx = indexByKey.get(keyId(key));
    if (idx === undefined) missing.push(key);
    else indices.push(idx);
  }

  return {
    ok: missing.length === 0,
    atomCount,
    indices,
    missing,
  };
}

export async function runTrajectoryFrames<T>(
  options: TrajectoryFrameRunOptions,
  visit: (context: TrajectoryFrameContext) => T | Promise<T>,
): Promise<TrajectoryFrameRunResult<T>> {
  const frameIndices = expandFrameRange(
    options.trajectory.length,
    options.run?.frameRange,
  );
  const results: Array<{ frameIndex: number; value: T }> = [];
  const failures: AnalysisFrameFailure[] = [];
  if (frameIndices.length === 0) {
    return { frameIndices, results, failures };
  }

  const referenceFrameIndex =
    options.run?.referenceFrameIndex ?? frameIndices[0];
  const referenceFrame = await options.trajectory.frame(referenceFrameIndex);
  const trackedSelection = resolveTrackedAtomSelection(
    referenceFrame,
    options.selection,
    referenceFrameIndex,
  );

  const fail = (frameIndex: number, error: Error) => {
    const failure = { frameIndex, error };
    failures.push(failure);
    options.run?.onFrameError?.(failure);
  };

  for (let ordinal = 0; ordinal < frameIndices.length; ordinal++) {
    if (options.run?.abortSignal?.aborted) throw new AnalysisAbortError();
    const frameIndex = frameIndices[ordinal];
    try {
      const frame = await options.trajectory.frame(frameIndex);
      const resolved = resolveTrackedAtomIndices(frame, trackedSelection);
      if (!resolved.ok) {
        const error = new Error(
          `Tracked atom selection is not valid for frame ${frameIndex}`,
        );
        if (options.run?.missingTrackedAtoms === "throw") throw error;
        fail(frameIndex, error);
        continue;
      }
      // Yield before heavy per-frame work so the compute UI stays responsive.
      await yieldToUi();
      const value = await visit({
        frame,
        frameIndex,
        ordinal,
        total: frameIndices.length,
        trackedSelection,
        atomIndices: resolved.indices,
      });
      results.push({ frameIndex, value });
    } catch (error) {
      fail(
        frameIndex,
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      options.run?.onProgress?.({
        completed: ordinal + 1,
        total: frameIndices.length,
        frameIndex,
      });
    }
  }

  return { frameIndices, results, failures, trackedSelection };
}
