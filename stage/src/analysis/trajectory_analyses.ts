/**
 * Multi-frame analyses: the RDF (radial distribution function) and MSD (mean
 * squared displacement) entry points.
 *
 * Neither owns a frame loop. Both delegate the walk to the shared runners in
 * `./trajectory_runner`, which is the one place that expands a frame range,
 * follows the selected atoms from frame to frame, records per-frame failures,
 * beats progress and honours cancellation. {@link computeRdfTrajectory} runs a
 * single-frame kernel through {@link runTrajectoryFrames} and averages the
 * per-frame histograms afterwards; {@link computeMsdTrajectory} has no
 * per-frame result to average, so it streams frames into an accumulator
 * through {@link runTrajectoryAccumulate} and reads it once at the end. What is
 * left in this file is the parameter types, what one frame computes, and how
 * the frames combine.
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
import { computeRdf } from "./rdf";
import type { RdfParams, RdfResult } from "./rdf_params";
import {
  type AnalysisAtomSelection,
  type AnalysisFrameFailure,
  type AnalysisRunOptions,
  type AnalysisTrajectorySource,
  expandFrameRange,
  resolveTrackedAtomIndices,
  resolveTrackedAtomSelection,
  runTrajectoryAccumulate,
  runTrajectoryFrames,
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
  /** Frames actually fed to the analyzer, in order; the first is the origin. */
  frameIndices: number[];
  /** Displacement series (Å²), one entry per fed frame. */
  result: MsdResult;
  /** Frames that failed on their own; the run continued past them. */
  failures: AnalysisFrameFailure[];
  /** How the selected atoms were followed across frames. */
  trackedSelection: TrackedAtomSelection;
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
 * The frames come from {@link runTrajectoryFrames} (`./trajectory_runner`), one
 * histogram per visit. Both atom groups are resolved once, on the reference
 * frame — {@link AnalysisRunOptions.referenceFrameIndex}, which defaults to the
 * first frame the range visits. Group A is the selection the runner itself
 * follows; group B is resolved here against that same frame and re-located
 * inside each visit, because the runner tracks one selection and a second
 * `selection` field on it would be the first field of an options bag. A group
 * that is a subset of the frame is followed across frames by the atoms' `id`
 * column when the frames carry a usable one (by row index otherwise, with a
 * warning on the tracked selection), so a reordered dump still histograms the
 * same atoms; a whole-frame group needs no tracking at all.
 *
 * A frame that fails on its own is recorded in `failures` and the run
 * continues. That includes every frame group B goes missing from, whatever
 * {@link AnalysisRunOptions.missingTrackedAtoms} says — the switch is the
 * runner's, so it governs group A alone. Cancellation is cooperative through
 * {@link AnalysisRunOptions.abortSignal} and lands at a frame boundary.
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
 * @throws Error from the runner, mid-range and with no result at all, when
 *   group A's atoms go missing from a frame and
 *   {@link AnalysisRunOptions.missingTrackedAtoms} is `"throw"`
 */
export async function computeRdfTrajectory(
  trajectory: AnalysisTrajectorySource,
  params: RdfTrajectoryParams = {},
  run: AnalysisRunOptions = {},
): Promise<RdfTrajectoryResult | null> {
  const frameIndices = expandFrameRange(trajectory.length, run.frameRange);
  if (frameIndices.length === 0) return null;

  // Group A is the selection the runner follows for us. Group B is resolved
  // here, on the same reference frame, and looked up per frame in the visit
  // below — a second `selection` field on the runner would buy nothing but the
  // first field of an options bag.
  const referenceFrameIndex = run.referenceFrameIndex ?? frameIndices[0];
  const trackedGroupB = params.groupBSelection
    ? resolveTrackedAtomSelection(
        await trajectory.frame(referenceFrameIndex),
        params.groupBSelection,
        referenceFrameIndex,
      )
    : undefined;

  const rdfParams: RdfParams = {
    rMax: params.rMax,
    rMin: params.rMin,
    nBins: params.nBins,
    volume: params.volume,
    representation: params.representation,
  };

  const frames = await runTrajectoryFrames<RdfResult | null>(
    { trajectory, selection: params.groupASelection, run },
    ({ frame, frameIndex, trackedSelection, atomIndices }) => {
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
        trackedSelection?.mode === "all" &&
        (trackedGroupB === undefined || trackedGroupB.mode === "all");
      return computeRdf(frame, {
        ...rdfParams,
        groupA: bothAll ? undefined : atomIndices,
        groupB: bothAll ? undefined : groupB?.indices,
      });
    },
  );

  // A frame with too few atoms histograms to `null`: visited, not failed, and
  // not part of the average either.
  const perFrame = frames.results
    .filter(
      (item): item is { frameIndex: number; value: RdfResult } =>
        item.value !== null,
    )
    .map((item) => ({ frameIndex: item.frameIndex, result: item.value }));

  const trackedGroupA = frames.trackedSelection;
  if (perFrame.length === 0 || !trackedGroupA) {
    // Prefer the real per-frame failure (box handle / volume / rMax) over a
    // silent null that the UI collapses to "Not enough atoms".
    if (frames.failures.length > 0) throw frames.failures[0].error;
    return null;
  }
  return {
    average: averageRdfResults(perFrame),
    perFrame,
    failures: frames.failures,
    trackedGroupA,
    trackedGroupB,
  };
}

/**
 * Mean squared displacement over a frame range.
 *
 * Writing r(t) for an atom's position at frame time t and r(0) for its position
 * in the origin frame, the MSD at a frame is the average of |r(t) − r(0)|² over
 * the tracked atoms, in Å²: how far, squared, atoms have wandered from where
 * they started. It grows roughly linearly with time for a diffusing liquid
 * and plateaus for atoms trapped in a solid, which is why it is the usual first
 * look at mobility.
 *
 * {@link runTrajectoryAccumulate} (`./trajectory_runner`) streams the range into
 * an {@link MsdAnalyzer} one frame at a time — no JavaScript array of frames is
 * ever held — and this function reads the analyzer once at the end and disposes
 * it, since the handle is its own.
 *
 * The **first frame actually fed is the origin**: displacements are measured
 * from it, so its own MSD is ~0, and it is `frameIndices[0]` of the result
 * rather than of the requested range — if the first planned frame fails, the
 * next one that feeds becomes the origin. That is a different frame from
 * {@link AnalysisRunOptions.referenceFrameIndex}, which only says where the
 * tracked selection is resolved. A subset selection is followed by the atoms'
 * `id` column when the frames carry a usable one (by row index otherwise), so
 * the same atoms are compared even if rows move between frames.
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
 *   requested or fewer than two could be fed (a displacement needs an origin
 *   frame and at least one later frame)
 * @throws AnalysisAbortError when the run was cancelled
 * @throws Error from the runner, mid-range and with no series at all, when the
 *   tracked atoms go missing from a frame and
 *   {@link AnalysisRunOptions.missingTrackedAtoms} is `"throw"`
 */
export async function computeMsdTrajectory(
  trajectory: AnalysisTrajectorySource,
  params: MsdTrajectoryParams = {},
  run: AnalysisRunOptions = {},
): Promise<MsdTrajectoryResult | null> {
  // A displacement needs an origin frame and a later one: too short a range
  // is answered before a single analyzer handle exists.
  if (expandFrameRange(trajectory.length, run.frameRange).length < 2) {
    return null;
  }

  // The analyzer is this function's handle: the runner only feeds it and reads
  // it, so freeing it stays here.
  const analyzer = new MsdAnalyzer();
  try {
    const fed = await runTrajectoryAccumulate(
      { trajectory, selection: params.selection, run },
      analyzer,
    );
    if (fed.fedFrameIndices.length < 2 || !fed.trackedSelection) return null;
    return {
      frameIndices: fed.fedFrameIndices,
      result: fed.value,
      failures: fed.failures,
      trackedSelection: fed.trackedSelection,
    };
  } finally {
    analyzer.dispose();
  }
}
