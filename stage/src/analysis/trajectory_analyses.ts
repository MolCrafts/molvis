/**
 * Multi-frame analyses: run a single-frame kernel over a frame range and
 * combine the per-frame results.
 *
 * Both entry points take any {@link AnalysisTrajectorySource} — the structural
 * "how many frames, and the frame at an index" surface — rather than the
 * concrete stage `Trajectory`. That is what lets the same code run on the main
 * thread against the live trajectory and inside the compute worker against
 * frames rebuilt from plain snapshots (`./job_runner`), so the two paths are one
 * computation and not two implementations to keep in sync.
 *
 * Frame selection, atom tracking, progress and cancellation all come from
 * {@link AnalysisRunOptions} (`./trajectory_runner`). Lengths are in Å
 * throughout, volumes in Å³.
 */

import { MsdAnalyzer, type MsdResult } from "./msd";
import type { RdfParams, RdfResult } from "./rdf";
import { computeRdf } from "./rdf";
import {
  AnalysisAbortError,
  type AnalysisAtomSelection,
  type AnalysisFrameFailure,
  type AnalysisRunOptions,
  type AnalysisTrajectorySource,
  expandFrameRange,
  resolveTrackedAtomIndices,
  resolveTrackedAtomSelection,
  type TrackedAtomSelection,
} from "./trajectory_runner";

export type {
  AnalysisProgress,
  AnalysisRunOptions,
  AnalysisTrajectorySource,
} from "./trajectory_runner";

/**
 * {@link RdfParams} (bins, cutoffs, volume, presentation) plus which atoms each
 * side of the pair histogram comes from.
 */
export interface RdfTrajectoryParams extends RdfParams {
  /** Atoms the distances are measured *from*. Defaults to all atoms. */
  groupASelection?: AnalysisAtomSelection;
  /** Atoms measured *to*. Omit for a self-histogram within group A. */
  groupBSelection?: AnalysisAtomSelection;
}

/** Per-frame histograms plus their average, and what was tracked to get them. */
export interface RdfTrajectoryResult {
  /**
   * Frame-averaged histogram: `gr`, `density` and `y` are means over the frames
   * that produced a histogram, while `counts` is their sum (total pair occupancy
   * across the range). `volume` is the mean over just those frames that had a
   * real reference volume, and `NaN` when none did.
   */
  average: RdfResult;
  /** One entry per frame that produced a histogram, in visit order. */
  perFrame: Array<{ frameIndex: number; result: RdfResult }>;
  /** Frames that failed on their own; the run continued past them. */
  failures: AnalysisFrameFailure[];
  /** How group A was followed across frames (`id` column or row index). */
  trackedGroupA: TrackedAtomSelection;
  /** Same for group B, absent when the run was a self-histogram. */
  trackedGroupB?: TrackedAtomSelection;
}

/** Which atoms to follow for a mean-squared-displacement run. */
export interface MsdTrajectoryParams {
  /** Atoms to track. Defaults to all atoms. */
  selection?: AnalysisAtomSelection;
}

/** An MSD series plus the frames and atoms it was built from. */
export interface MsdTrajectoryResult {
  /** Frames actually fed to the analyzer, in order; the first is the reference. */
  frameIndices: number[];
  /** Displacement series (Å²), one entry per fed frame. */
  result: MsdResult;
  /** Frames that failed on their own; the run continued past them. */
  failures: AnalysisFrameFailure[];
  /** How the selected atoms were followed across frames. */
  trackedSelection: TrackedAtomSelection;
}

function fail(
  failures: AnalysisFrameFailure[],
  frameIndex: number,
  error: Error,
  onFrameError?: (failure: AnalysisFrameFailure) => void,
): void {
  const failure = { frameIndex, error };
  failures.push(failure);
  onFrameError?.(failure);
}

function averageRdfResults(
  results: Array<{ frameIndex: number; result: RdfResult }>,
): RdfResult {
  const first = results[0].result;
  const n = results.length;
  const gr = new Float64Array(first.nBins);
  const counts = new Float64Array(first.nBins);
  const density = new Float64Array(first.nBins);
  const y = new Float64Array(first.nBins);
  for (const { result } of results) {
    for (let i = 0; i < first.nBins; i++) {
      gr[i] += result.gr[i];
      counts[i] += result.counts[i];
      density[i] += result.density[i];
      y[i] += result.y[i];
    }
  }
  for (let i = 0; i < first.nBins; i++) {
    gr[i] /= n;
    density[i] /= n;
    y[i] /= n;
    // counts: keep total across frames (trajectory pair occupancy)
  }
  const volumeSum = results.reduce(
    (sum, item) =>
      sum +
      (item.result.hasReferenceVolume && Number.isFinite(item.result.volume)
        ? item.result.volume
        : 0),
    0,
  );
  const volumeCount = results.filter(
    (item) =>
      item.result.hasReferenceVolume && Number.isFinite(item.result.volume),
  ).length;
  return {
    ...first,
    r: new Float64Array(first.r),
    gr,
    counts,
    density,
    y,
    volume: volumeCount > 0 ? volumeSum / volumeCount : Number.NaN,
  };
}

/**
 * Radial distribution function over a frame range.
 *
 * The RDF, written g(r), answers "how much more (or less) likely is it to find a
 * second atom at distance r from a given atom than if the atoms were spread
 * uniformly?" — a peak at r means a preferred separation, e.g. a first
 * coordination shell. One histogram is computed per frame with {@link computeRdf}
 * and the frames are then combined: g(r), the shell density and the presented
 * series are averaged, while raw pair counts are summed. See {@link
 * RdfParams.representation} for the p(r) / ρ(r) alternatives when the frame has
 * no cell to normalise against.
 *
 * The two atom groups are resolved once, on the first visited frame. A group
 * that is a subset of the frame is then followed across frames by the atoms'
 * `id` column when the frames carry a usable one (by row index otherwise, with a
 * warning on the tracked selection), so a reordered dump still histograms the
 * same atoms; a whole-frame group needs no tracking at all.
 *
 * A frame that fails on its own is recorded in `failures` and the run continues;
 * cancellation is cooperative through {@link AnalysisRunOptions.abortSignal} and
 * lands at a frame boundary.
 *
 * @param trajectory any frame source — the live stage trajectory, or the
 *   worker's snapshot-backed source
 * @param params histogram settings and the two atom groups
 * @param run frame range, progress, per-frame error hook, abort signal
 * @returns the per-frame histograms and their average, or `null` when the frame
 *   range is empty or no frame had enough atoms to histogram
 * @throws AnalysisAbortError when the run was cancelled
 * @throws Error re-raising the first per-frame failure when *every* frame failed
 *   — a real cause (bad cutoff, missing cell, missing tracked atoms) beats a
 *   silent `null`
 */
export async function computeRdfTrajectory(
  trajectory: AnalysisTrajectorySource,
  params: RdfTrajectoryParams = {},
  run: AnalysisRunOptions = {},
): Promise<RdfTrajectoryResult | null> {
  const frameIndices = expandFrameRange(trajectory.length, run.frameRange);
  if (frameIndices.length === 0) return null;

  const referenceFrameIndex = frameIndices[0];
  const referenceFrame = await trajectory.frame(referenceFrameIndex);
  const trackedGroupA = resolveTrackedAtomSelection(
    referenceFrame,
    params.groupASelection,
    referenceFrameIndex,
  );
  const trackedGroupB = params.groupBSelection
    ? resolveTrackedAtomSelection(
        referenceFrame,
        params.groupBSelection,
        referenceFrameIndex,
      )
    : undefined;

  const perFrame: Array<{ frameIndex: number; result: RdfResult }> = [];
  const failures: AnalysisFrameFailure[] = [];
  const rdfParams: RdfParams = {
    rMax: params.rMax,
    rMin: params.rMin,
    nBins: params.nBins,
    volume: params.volume,
    representation: params.representation,
  };

  for (let ordinal = 0; ordinal < frameIndices.length; ordinal++) {
    if (run.abortSignal?.aborted) throw new AnalysisAbortError();
    const frameIndex = frameIndices[ordinal];
    try {
      const frame = await trajectory.frame(frameIndex);
      const groupA = resolveTrackedAtomIndices(frame, trackedGroupA);
      if (!groupA.ok) {
        throw new Error(
          `Group A tracked atoms are missing in frame ${frameIndex}`,
        );
      }
      const groupB = trackedGroupB
        ? resolveTrackedAtomIndices(frame, trackedGroupB)
        : undefined;
      if (groupB && !groupB.ok) {
        throw new Error(
          `Group B tracked atoms are missing in frame ${frameIndex}`,
        );
      }

      // Both groups "all" → full-frame self-RDF (no sub-frame clone).
      const bothAll =
        trackedGroupA.mode === "all" &&
        (trackedGroupB === undefined || trackedGroupB.mode === "all");
      const result = computeRdf(frame, {
        ...rdfParams,
        groupA: bothAll ? undefined : groupA.indices,
        groupB: bothAll ? undefined : groupB?.indices,
      });
      if (result) perFrame.push({ frameIndex, result });
    } catch (error) {
      fail(
        failures,
        frameIndex,
        error instanceof Error ? error : new Error(String(error)),
        run.onFrameError,
      );
    } finally {
      run.onProgress?.({
        completed: ordinal + 1,
        total: frameIndices.length,
        frameIndex,
      });
    }
  }

  if (perFrame.length === 0) {
    // Prefer the real per-frame failure (box handle / volume / rMax) over a
    // silent null that the UI collapses to "Not enough atoms".
    if (failures.length > 0) throw failures[0].error;
    return null;
  }
  return {
    average: averageRdfResults(perFrame),
    perFrame,
    failures,
    trackedGroupA,
    trackedGroupB,
  };
}

/**
 * Mean squared displacement over a frame range.
 *
 * The MSD at a frame is the average of |r(t) − r(0)|² over the tracked atoms,
 * in Å²: how far, squared, atoms have wandered from where they were in the
 * reference frame. It grows roughly linearly with time for a diffusing liquid
 * and plateaus for atoms trapped in a solid, which is why it is the usual first
 * look at mobility.
 *
 * The **first visited frame is the reference** — displacements are measured from
 * it, so its own MSD is ~0. Frames are streamed into {@link MsdAnalyzer} in visit
 * order rather than held as a JavaScript array of frames, and the analyzer is
 * disposed before returning. A subset selection is followed by the atoms' `id`
 * column when the frames carry a usable one (by row index otherwise), so the
 * same atoms are compared even if rows move between frames.
 *
 * A frame that fails on its own is recorded in `failures` and skipped;
 * cancellation is cooperative through {@link AnalysisRunOptions.abortSignal} and
 * lands at a frame boundary.
 *
 * @param trajectory any frame source — the live stage trajectory, or the
 *   worker's snapshot-backed source
 * @param params which atoms to track
 * @param run frame range, progress, per-frame error hook, abort signal
 * @returns the displacement series, or `null` when fewer than two frames were
 *   requested or fewer than two could be fed (a displacement needs a reference
 *   frame and at least one later frame)
 * @throws AnalysisAbortError when the run was cancelled
 */
export async function computeMsdTrajectory(
  trajectory: AnalysisTrajectorySource,
  params: MsdTrajectoryParams = {},
  run: AnalysisRunOptions = {},
): Promise<MsdTrajectoryResult | null> {
  const frameIndices = expandFrameRange(trajectory.length, run.frameRange);
  if (frameIndices.length < 2) return null;

  const referenceFrameIndex = frameIndices[0];
  const referenceFrame = await trajectory.frame(referenceFrameIndex);
  const trackedSelection = resolveTrackedAtomSelection(
    referenceFrame,
    params.selection,
    referenceFrameIndex,
  );
  const analyzer = new MsdAnalyzer();
  const failures: AnalysisFrameFailure[] = [];
  const fedFrameIndices: number[] = [];

  try {
    for (let ordinal = 0; ordinal < frameIndices.length; ordinal++) {
      if (run.abortSignal?.aborted) throw new AnalysisAbortError();
      const frameIndex = frameIndices[ordinal];
      try {
        const frame = await trajectory.frame(frameIndex);
        const resolved = resolveTrackedAtomIndices(frame, trackedSelection);
        if (!resolved.ok) {
          throw new Error(`Tracked atoms are missing in frame ${frameIndex}`);
        }
        analyzer.feed(
          frame,
          trackedSelection.mode === "all" ? undefined : resolved.indices,
        );
        fedFrameIndices.push(frameIndex);
      } catch (error) {
        fail(
          failures,
          frameIndex,
          error instanceof Error ? error : new Error(String(error)),
          run.onFrameError,
        );
      } finally {
        run.onProgress?.({
          completed: ordinal + 1,
          total: frameIndices.length,
          frameIndex,
        });
      }
    }

    if (fedFrameIndices.length < 2) return null;
    return {
      frameIndices: fedFrameIndices,
      result: analyzer.result(),
      failures,
      trackedSelection,
    };
  } finally {
    analyzer.dispose();
  }
}
