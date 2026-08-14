/**
 * Main-thread orchestration of one analysis run: resolve the frame range, walk
 * it, and put what comes back into a single envelope.
 *
 * The dispatch itself — how a catalog `inputKind` becomes a molrs binding call,
 * and how a binding's parameters are coerced — is `./shape_dispatch`, the
 * thread-independent half, which this module imports and drives. Main → Kernel
 * is the only direction: nothing in `./shape_dispatch` may reach back here.
 *
 * What stays is what is genuinely main-thread. The `series` shape stacks a
 * per-atom velocity matrix across frames, and velocities are not part of the
 * analysis wire, so that shape has no worker form at all — `snapshotCoversAnalysis`
 * (`./worker_protocol`) is the machine-readable statement of that. And
 * {@link AnalysisRunResult} carries real `Error`s plus the tracked selection,
 * neither of which survives `postMessage` intact.
 *
 * The one id comparison left in a shape here (`runSeries`) chooses *what a
 * binding is fed* — a velocity autocorrelation ahead of the spectrum;
 * `runAccumulate` has one more, choosing which driver accumulates.
 */

import * as molrs from "@molcrafts/molvis-core/molrs";
import type { Trajectory } from "../system/trajectory";
import { MSD_ANALYSIS_ID, POWER_SPECTRUM_ANALYSIS_ID } from "./analysis_ids";
import { MsdAnalyzer } from "./msd";
import type { AnalysisDefinition, AnalysisResultKind } from "./registry";
import {
  type AnalysisParamValues,
  CatalogAccumulator,
  callNumber,
  instantiate,
  PER_FRAME_KINDS,
  runSingleFrame,
} from "./shape_dispatch";
import {
  AnalysisAbortError,
  type AnalysisAtomSelection,
  type AnalysisFrameFailure,
  type AnalysisProgress,
  AnalysisUnsupportedError,
  expandFrameRange,
  type FrameRange,
  resolveTrackedAtomIndices,
  resolveTrackedAtomSelection,
  runTrajectoryAccumulate,
  runTrajectoryFrames,
  type TrackedAtomSelection,
  type TrajectoryFrameRunOptions,
} from "./trajectory_runner";

// Re-exported under their original names, so their public import path is
// unchanged while each declaration sits where the modules that need it can
// reach it without importing this main-thread module: `AnalysisParamValues`
// beside the coercion it feeds (`./shape_dispatch`), `AnalysisUnsupportedError`
// beside `AnalysisAbortError` (`./trajectory_runner`).
export type { AnalysisParamValues };
export { AnalysisUnsupportedError };

/**
 * One dispatch run. Distinct from `trajectory_runner`'s `AnalysisRunOptions`,
 * which is the frame-walking shape the kernels share.
 */
export interface AnalysisDispatchOptions {
  definition: AnalysisDefinition;
  params: AnalysisParamValues;
  trajectory: Trajectory;
  frameRange?: FrameRange;
  selection?: AnalysisAtomSelection;
  abortSignal?: AbortSignal;
  onProgress?: (progress: AnalysisProgress) => void;
}

export interface AnalysisRunResult {
  analysisId: string;
  resultKind: AnalysisResultKind;
  /** Frames actually visited, after the range and stride were applied. */
  frameIndices: number[];
  /**
   * One payload per visited frame for per-frame shapes; a single payload for
   * accumulators and array-driven analyses.
   */
  payload: unknown;
  perFrame: boolean;
  failures: AnalysisFrameFailure[];
  trackedSelection?: TrackedAtomSelection;
}

// ---------------------------------------------------------------------------
// Accumulating and array-driven shapes
// ---------------------------------------------------------------------------

/** The `accumulate` shape — feed every visited frame, read the result once. */
async function runAccumulate(
  options: AnalysisDispatchOptions,
  frameIndices: number[],
): Promise<AnalysisRunResult> {
  const { definition } = options;
  const envelope = {
    analysisId: definition.id,
    resultKind: definition.resultKind,
    frameIndices,
    perFrame: false,
  };

  // The one id judgment left in this module: which driver accumulates. The
  // catalog says an analysis accumulates but not how its result comes out —
  // MSD's molrs binding answers `results()`, every other accumulator answers
  // `compute()` — so this switch is the same temporary seam the "Temporary
  // seam" note in `./result_marshal` spells out: a shape the molrs catalog does
  // not publish, written down on this side until it does. It shrinks the same
  // way, too: that module's MSD entry already left when `MsdAnalyzer` became
  // the only MSD driver and took over its own copy-and-free.
  if (definition.id === MSD_ANALYSIS_ID) {
    const analyzer = new MsdAnalyzer();
    try {
      const fed = await runTrajectoryAccumulate(
        frameRunOptions(options),
        analyzer,
      );
      return {
        ...envelope,
        payload: fed.value.frames,
        failures: fed.failures,
        trackedSelection: fed.trackedSelection,
      };
    } finally {
      analyzer.dispose();
    }
  }

  const accumulator = new CatalogAccumulator(definition, options.params);
  try {
    const fed = await runTrajectoryAccumulate(
      frameRunOptions(options),
      accumulator,
    );
    return {
      ...envelope,
      payload: fed.value,
      failures: fed.failures,
      trackedSelection: fed.trackedSelection,
    };
  } finally {
    accumulator.dispose();
  }
}

/**
 * Stack a per-atom vector column across the visited frames into the
 * `(nFrames × nDof)` matrix the transport kernels bin over: one row per frame,
 * and `nDof` — degrees of freedom — components per row, three per tracked atom,
 * laid out `[x, y, z]` for the first atom, then the second, and so on.
 *
 * Deliberately **not** a `runTrajectoryFrames` visit, unlike every other loop
 * in this module. Three reasons, none of which the runner can express together:
 * the product is one whole matrix rather than a result per frame, so there is
 * nothing per-frame to collect; it is all-or-nothing on purpose — one frame
 * missing a velocity column fails the entire run, because a hole in the middle
 * of a time series is not a time series, where the runner's contract is to
 * record that frame and walk on; and it emits no progress beats at all, where
 * the runner beats once per planned frame. Going through the runner would mean
 * changing one of those semantics or adding a mode switch to the runner's
 * options, so this loop is an explicit exception, not an oversight.
 *
 * Cancellation is still honoured, checked at each frame boundary.
 */
async function stackVectorColumns(
  options: AnalysisDispatchOptions,
  frameIndices: number[],
  columns: readonly string[],
  tracked: TrackedAtomSelection,
): Promise<{ data: Float64Array; nFrames: number; nDof: number }> {
  const rows: Float64Array[] = [];
  let nDof = 0;
  for (const frameIndex of frameIndices) {
    if (options.abortSignal?.aborted) throw new AnalysisAbortError();
    const frame = await options.trajectory.frame(frameIndex);
    const atoms = frame.getBlock("atoms");
    if (!atoms) throw new Error(`frame ${frameIndex} has no atoms block`);
    const resolved = resolveTrackedAtomIndices(frame, tracked);
    if (!resolved.ok) {
      throw new Error(
        `tracked atom selection is not valid for frame ${frameIndex}`,
      );
    }
    const data = columns.map((column) => atoms.copyColF(column));
    const row = new Float64Array(resolved.indices.length * columns.length);
    resolved.indices.forEach((atomIndex, slot) => {
      for (let c = 0; c < columns.length; c++) {
        row[slot * columns.length + c] = data[c][atomIndex];
      }
    });
    if (nDof === 0) nDof = row.length;
    if (row.length !== nDof) {
      throw new Error(
        `frame ${frameIndex} has ${row.length} velocity components, expected ${nDof}`,
      );
    }
    rows.push(row);
  }
  const data = new Float64Array(rows.length * nDof);
  for (let i = 0; i < rows.length; i++) data.set(rows[i], i * nDof);
  return { data, nFrames: rows.length, nDof };
}

const VELOCITY_COLUMNS = ["vx", "vy", "vz"] as const;

async function runSeries(
  options: AnalysisDispatchOptions,
  frameIndices: number[],
  tracked: TrackedAtomSelection,
): Promise<unknown> {
  const { definition, params } = options;
  if (!definition.requires.includes("velocity")) {
    throw new AnalysisUnsupportedError(
      definition.id,
      `it needs ${definition.requires.join(", ")}, which this build cannot assemble from a trajectory`,
    );
  }

  const { data, nFrames, nDof } = await stackVectorColumns(
    options,
    frameIndices,
    VELOCITY_COLUMNS,
    tracked,
  );

  if (definition.id === POWER_SPECTRUM_ANALYSIS_ID) {
    // The VDOS (vibrational density of states) is the power spectrum of the raw
    // velocity ACF (autocorrelation function), computed here by `WasmVACF`.
    // `resolution` is a call-slot knob precisely because it configures that
    // upstream stage, not the spectrum object.
    const dtFs = callNumber(definition, params, "dtFs");
    const vacf = new molrs.WasmVACF(
      dtFs,
      callNumber(definition, params, "resolution"),
    );
    const raw = vacf.compute(data, nFrames, nDof) as { values: number[] };
    vacf.free();
    const instance = instantiate(definition, params);
    try {
      return instance.fit?.(Float64Array.from(raw.values));
    } finally {
      instance.free?.();
    }
  }

  const instance = instantiate(definition, params);
  try {
    return instance.compute?.(data, nFrames, nDof);
  } finally {
    instance.free?.();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** This run, as the frame-walking shape `./trajectory_runner` takes. */
function frameRunOptions(
  options: AnalysisDispatchOptions,
): TrajectoryFrameRunOptions {
  return {
    trajectory: options.trajectory,
    selection: options.selection,
    run: {
      frameRange: options.frameRange,
      abortSignal: options.abortSignal,
      onProgress: options.onProgress,
    },
  };
}

/**
 * Run `definition` over the trajectory's `frameRange`, tracking the atoms
 * picked in the reference frame across every visited frame.
 *
 * Per-frame shapes produce one payload per frame; accumulators and
 * array-driven shapes produce a single payload for the whole range.
 */
export async function runAnalysis(
  options: AnalysisDispatchOptions,
): Promise<AnalysisRunResult> {
  const { definition, trajectory } = options;
  const frameIndices = expandFrameRange(trajectory.length, options.frameRange);
  const failures: AnalysisFrameFailure[] = [];

  if (frameIndices.length === 0) {
    return {
      analysisId: definition.id,
      resultKind: definition.resultKind,
      frameIndices,
      payload: undefined,
      perFrame: PER_FRAME_KINDS.has(definition.inputKind),
      failures,
    };
  }

  if (definition.inputKind === "accumulate") {
    return runAccumulate(options, frameIndices);
  }

  if (definition.inputKind === "series") {
    const referenceFrame = await trajectory.frame(frameIndices[0]);
    const tracked = resolveTrackedAtomSelection(
      referenceFrame,
      options.selection,
      frameIndices[0],
    );
    return {
      analysisId: definition.id,
      resultKind: definition.resultKind,
      frameIndices,
      payload: await runSeries(options, frameIndices, tracked),
      perFrame: false,
      failures,
      trackedSelection: tracked,
    };
  }

  if (definition.inputKind === "frameGroupSets") {
    throw new AnalysisUnsupportedError(
      definition.id,
      "joint distributions need an explicit per-observable atom-group editor",
    );
  }

  const frames = await runTrajectoryFrames<unknown>(
    frameRunOptions(options),
    ({ frame, atomIndices }) =>
      runSingleFrame(frame, definition, options.params, atomIndices ?? []),
  );

  return {
    analysisId: definition.id,
    resultKind: definition.resultKind,
    // The frames that produced a payload, not the frames the range planned.
    frameIndices: frames.results.map((item) => item.frameIndex),
    payload: frames.results,
    perFrame: true,
    failures: frames.failures,
    trackedSelection: frames.trackedSelection,
  };
}
