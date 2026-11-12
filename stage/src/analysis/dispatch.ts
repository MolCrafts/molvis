/**
 * Main-thread orchestration of one analysis run: resolve the frame range, walk
 * it, and put what comes back into a single envelope.
 *
 * The dispatch itself — how a catalog entry becomes a molrs compute call, and
 * how its parameters are coerced — is `./shape_dispatch`, the
 * thread-independent half, which this module imports and drives. Main → Kernel
 * is the only direction: nothing in `./shape_dispatch` may reach back here.
 *
 * What stays is what is genuinely main-thread: {@link AnalysisRunResult}
 * carries real `Error`s plus the tracked selection, neither of which survives
 * `postMessage` intact. `runAccumulate` has the one id comparison left,
 * choosing which driver accumulates.
 */

import type { Trajectory } from "../system/trajectory";
import { MSD_ANALYSIS_ID } from "./analysis_ids";
import { MsdAnalyzer } from "./msd";
import type { AnalysisDefinition, AnalysisResultKind } from "./registry";
import {
  type AnalysisParamValues,
  CatalogAccumulator,
  PER_FRAME_KINDS,
  runSingleFrame,
} from "./shape_dispatch";
import {
  type AnalysisAtomSelection,
  type AnalysisFrameFailure,
  type AnalysisProgress,
  AnalysisUnsupportedError,
  expandFrameRange,
  type FrameRange,
  resolveVisitLength,
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

/** The `trajectory` kind — feed every visited frame, read the result once. */
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

  // The one id judgment left in this module: which driver accumulates. MSD's
  // panel reads a per-frame displacement series (`MsdAnalyzer`), not the lag
  // correlation the catalog compute answers, so it keeps its own driver.
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
    // A hole in the middle of a time series is not a time series: one frame
    // that could not be fed fails the run instead of being skipped.
    if (fed.failures.length > 0) throw fed.failures[0].error;
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
  const frameIndices = expandFrameRange(
    resolveVisitLength(trajectory, options.frameRange),
    options.frameRange,
  );
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

  if (definition.inputKind === "trajectory") {
    return runAccumulate(options, frameIndices);
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
