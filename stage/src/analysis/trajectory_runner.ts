import type { Frame } from "@molcrafts/molvis-core/molrs";
import type { SelectionMask } from "../pipeline/types";
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
   * visited frame. `computeRdfTrajectory` (`./trajectory_analyses`) reads it
   * too, so its second atom group is followed from the same reference frame as
   * the first.
   *
   * It only says where the selection is *resolved*: the frame is read but not
   * itself visited unless the range happens to include it, and it is not any
   * analysis's own origin — a mean-squared-displacement (MSD) run still
   * measures displacements from the first frame it actually feeds.
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
   * What to do when a frame does not contain the tracked atoms — record a
   * failure for that frame and move on (`"skip-frame"`, the default), or end
   * the whole run.
   *
   * `"throw"` really does end it: {@link runTrajectoryFrames} rejects with that
   * frame's error at the first frame it cannot resolve, so later frames are
   * never visited and no partial result comes back — the frames already walked
   * are lost with it. Choose it when a hole in the tracked set makes the answer
   * wrong rather than merely thinner.
   *
   * Judged only for the runner's own
   * {@link TrajectoryFrameRunOptions.selection}. An analysis that tracks a
   * second group itself — `computeRdfTrajectory`'s group B
   * (`./trajectory_analyses`) — raises from inside its per-frame callback,
   * which is that frame's own failure whatever this switch says. The RDF
   * (radial distribution function) and MSD helpers forward whatever the caller
   * passed and pin nothing.
   */
  missingTrackedAtoms?: "skip-frame" | "throw";
}

/**
 * The trajectory surface a multi-frame analysis needs: how many frames there
 * are, and the frame at an index.
 *
 * Structural on purpose. The concrete stage `Trajectory` (`../system/trajectory`)
 * satisfies it, and so does a worker-side source rebuilt from plain frame
 * snapshots — an analysis kernel never needs the rest of the stage `System`
 * graph to run. Nothing in this module imports either of them: its only runtime
 * dependencies are `../utils/dtype` and `../utils/yield_ui`.
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

/** One walk over a frame range: where the frames come from, and how to walk. */
export interface TrajectoryFrameRunOptions {
  /**
   * Where the frames come from — any {@link AnalysisTrajectorySource}, not the
   * concrete stage `Trajectory`. The live trajectory satisfies that surface
   * structurally, and so does a worker-side source rebuilt from plain frame
   * snapshots (`./job_runner`), which is what lets one runner serve both the
   * main thread and the compute worker.
   */
  trajectory: AnalysisTrajectorySource;
  /** Atoms to follow across the range. Defaults to every atom. */
  selection?: AnalysisAtomSelection;
  /** Range, reference frame, progress, cancellation, failure policy. */
  run?: AnalysisRunOptions;
}

export interface TrajectoryFrameRunResult<T> {
  frameIndices: number[];
  results: Array<{ frameIndex: number; value: T }>;
  failures: AnalysisFrameFailure[];
  trackedSelection?: TrackedAtomSelection;
}

/**
 * Something that consumes frames one at a time and answers once at the end —
 * an MSD accumulator, a molrs binding with a `feed`/`compute` pair.
 *
 * Structural, like {@link AnalysisTrajectorySource}: a type that already has
 * these two methods satisfies it with no adapter (`MsdAnalyzer` in `./msd`
 * does), which is why nothing here imports a concrete sink.
 *
 * The sink is **the caller's**: the caller constructs it and the caller
 * releases it. {@link runTrajectoryAccumulate} only ever calls these two
 * methods, never `dispose` / `free` / `close` / `reset`, because releasing a
 * handle holder it did not build would free molrs (Rust/WebAssembly) memory out
 * from under its owner.
 */
export interface TrajectoryAccumulateSink<T> {
  /**
   * Take one frame.
   *
   * `atomIndices` is absent when the whole frame is selected — the sink then
   * feeds the frame straight through instead of building a sub-frame — and is
   * otherwise the tracked atoms' rows **in this frame**, already resolved.
   */
  feed(frame: Frame, atomIndices?: readonly number[]): void;
  /** What the fed frames add up to. Read once, at the end of a run. */
  result(): T;
}

/**
 * What {@link runTrajectoryAccumulate} answers: the sink's result, plus which
 * frames reached it.
 */
export interface TrajectoryAccumulateRunResult<T> {
  /** Whatever {@link TrajectoryAccumulateSink.result} answered. */
  value: T;
  /**
   * Frames actually fed, in visit order. Whether that is enough to mean
   * anything is the caller's judgment: MSD needs two, another sink may need one.
   */
  fedFrameIndices: number[];
  /** Frames the range planned, fed or failed. */
  frameIndices: number[];
  /** Frames that failed on their own; the walk went on past each of them. */
  failures: AnalysisFrameFailure[];
  /** How the atoms were followed; absent only when the range was empty. */
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

function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/** A frame ready to visit, or why it is not. */
type FramePreparation =
  | { kind: "ready"; frame: Frame; atomIndices: number[] }
  | { kind: "unreadable"; error: Error }
  | { kind: "missing-tracked-atoms"; error: Error };

/**
 * Read the frame at `frameIndex` and locate the tracked atoms in it.
 *
 * Reports failure as a value rather than by throwing, so the caller can tell a
 * frame that failed on its own from a tracked selection that invalidates the
 * whole run — the second verdict has to leave the frame loop, and a `catch`
 * around it would demote it to one more per-frame failure.
 */
async function prepareFrame(
  trajectory: AnalysisTrajectorySource,
  frameIndex: number,
  tracked: TrackedAtomSelection,
): Promise<FramePreparation> {
  let frame: Frame;
  try {
    frame = await trajectory.frame(frameIndex);
  } catch (error) {
    return { kind: "unreadable", error: asError(error) };
  }
  const resolved = resolveTrackedAtomIndices(frame, tracked);
  if (!resolved.ok) {
    return {
      kind: "missing-tracked-atoms",
      error: new Error(
        `Tracked atom selection is not valid for frame ${frameIndex}`,
      ),
    };
  }
  return { kind: "ready", frame, atomIndices: resolved.indices };
}

/**
 * Walk a frame range, calling `visit` once per frame with that frame's tracked
 * atom rows.
 *
 * The one frame loop the analyses share. The selection is resolved once on the
 * reference frame and re-located in every frame, so a reordering dump still
 * visits the same atoms; a frame that fails on its own — unreadable, or missing
 * tracked atoms under the default `"skip-frame"` — becomes an entry in
 * `failures` and the walk goes on. Progress beats once per planned frame,
 * failures included, which is what `./job_runner` maps back to its own frame
 * numbering.
 *
 * @param options frame source, atom selection, and the run knobs
 * @param visit what to compute for one frame; its return value lands in
 *   `results` alongside the frame index
 * @returns the planned frames, the per-frame values, the failures, and how the
 *   atoms were tracked
 * @throws AnalysisAbortError at the next frame boundary after
 *   {@link AnalysisRunOptions.abortSignal} was aborted
 * @throws Error when a frame cannot locate the tracked atoms and
 *   {@link AnalysisRunOptions.missingTrackedAtoms} is `"throw"` — that verdict
 *   is about the run, so it ends the walk instead of joining `failures`
 */
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
    const prepared = await prepareFrame(
      options.trajectory,
      frameIndex,
      trackedSelection,
    );
    // Decided *before* the try below, on purpose: "throw" is a verdict on the
    // whole run, and inside the try the catch would record it as this frame's
    // own failure — which is how the switch came to mean nothing at all.
    if (
      prepared.kind === "missing-tracked-atoms" &&
      options.run?.missingTrackedAtoms === "throw"
    ) {
      throw prepared.error;
    }
    try {
      if (prepared.kind === "ready") {
        // Yield before heavy per-frame work so the compute UI stays responsive.
        await yieldToUi();
        const value = await visit({
          frame: prepared.frame,
          frameIndex,
          ordinal,
          total: frameIndices.length,
          trackedSelection,
          atomIndices: prepared.atomIndices,
        });
        results.push({ frameIndex, value });
      } else {
        fail(frameIndex, prepared.error);
      }
    } catch (error) {
      fail(frameIndex, asError(error));
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

/**
 * Feed a frame range into `sink` and read its result once, at the end.
 *
 * The frame walking — range, atom tracking, per-frame failures, progress beats,
 * cancellation — is {@link runTrajectoryFrames}'s, so an accumulating analysis
 * and a per-frame one visit frames the same way and there is no second loop to
 * keep in sync. What this adds is the feed rule: a whole-frame selection feeds
 * the raw frame with no atom indices, and a subset feeds the rows the tracked
 * atoms occupy *in that frame*, so a sink that builds a sub-frame builds the
 * right one after a reordering dump.
 *
 * The sink is the caller's to construct and to release: nothing here disposes
 * it, not even when the run is cancelled. A frame the sink rejects is recorded
 * as that frame's failure and the run goes on, so `fedFrameIndices` can be
 * shorter than `frameIndices`.
 *
 * @param options frame source, atom selection, and the run knobs
 * @param sink what the frames are fed to
 * @returns the sink's result plus which frames reached it
 * @throws AnalysisAbortError when the run was cancelled — `sink.result()` is
 *   then never read, and the sink keeps whatever it had accumulated
 * @throws Error when a frame cannot locate the tracked atoms and
 *   {@link AnalysisRunOptions.missingTrackedAtoms} is `"throw"`; same exit as a
 *   cancel — the walk stops there, `sink.result()` is never read, and the
 *   already-fed frames are lost with the rejected promise
 * @example
 * ```ts
 * const analyzer = new MsdAnalyzer();
 * try {
 *   const run = await runTrajectoryAccumulate({ trajectory }, analyzer);
 *   return run.fedFrameIndices.length < 2 ? null : run.value;
 * } finally {
 *   analyzer.dispose();
 * }
 * ```
 */
export async function runTrajectoryAccumulate<T>(
  options: TrajectoryFrameRunOptions,
  sink: TrajectoryAccumulateSink<T>,
): Promise<TrajectoryAccumulateRunResult<T>> {
  const run = await runTrajectoryFrames<void>(
    options,
    ({ frame, trackedSelection, atomIndices }) => {
      sink.feed(
        frame,
        trackedSelection?.mode === "all" ? undefined : atomIndices,
      );
    },
  );
  return {
    value: sink.result(),
    // A visit that returned is a frame the sink took; the failures are the rest.
    fedFrameIndices: run.results.map((item) => item.frameIndex),
    frameIndices: run.frameIndices,
    failures: run.failures,
    trackedSelection: run.trackedSelection,
  };
}
