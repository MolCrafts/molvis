/**
 * Dispatch an analysis by its catalog `inputKind` — the data shape its molrs
 * binding consumes — never by its id.
 *
 * Every molrs binding is constructor-configured — `compute` and `fit` take only
 * data — so building one is always `new Ctor(...ctorSlotParams)`. A `call`-slot
 * parameter configures a *different* object this module builds first: the
 * neighbor `cutoff` belongs to `LinkedCell`, `minClusterSize` to `Cluster`,
 * `resolution` to an upstream flux stage, `labelBy` picks the column that
 * becomes a `labels` data argument.
 *
 * The id comparisons left inside a shape (`runFrameRadii`, `runSeries`) choose
 * *what a binding is fed* — atom labels, a void mask, a velocity
 * autocorrelation ahead of the spectrum; `runAccumulate` has one more, choosing
 * which driver accumulates. What a binding's *result* looks like is never
 * decided here: every result leaves through `marshalAnalysisResult`
 * (`./result_marshal`).
 */

import * as molrs from "@molcrafts/molvis-core/molrs";
import { Cluster, type Frame } from "@molcrafts/molvis-core/molrs";
import { SpatialNeighborQuery } from "../algo/neighbor_list";
import type { Trajectory } from "../system/trajectory";
import {
  MSD_ANALYSIS_ID,
  POWER_SPECTRUM_ANALYSIS_ID,
  VORONOI_DOMAIN_ANALYSIS_ID,
  VORONOI_RADICAL_ANALYSIS_ID,
  VORONOI_VOID_ANALYSIS_ID,
} from "./analysis_ids";
import { buildAtomSubFrame } from "./frame_subset";
import { MsdAnalyzer } from "./msd";
import {
  angleTriples,
  atomLabels,
  bondPairs,
  dihedralQuads,
  voidMask,
} from "./panel_inputs";
import type {
  AnalysisDefinition,
  AnalysisParamSpec,
  AnalysisResultKind,
} from "./registry";
import { marshalAnalysisResult } from "./result_marshal";
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
  type TrajectoryAccumulateSink,
  type TrajectoryFrameRunOptions,
} from "./trajectory_runner";

/**
 * Panel-supplied parameter values for one run, keyed by
 * {@link AnalysisParamSpec.key}. Coerced to the spec's declared kind before it
 * reaches a binding.
 */
export type AnalysisParamValues = Record<string, number | boolean | string>;

/**
 * Re-exported under its original name: the declaration sits beside
 * `AnalysisAbortError` in `./trajectory_runner`, where `./result_marshal` can
 * reach it without importing this main-thread module, while callers keep
 * importing it from here (and from `./index`, which re-exports this module).
 */
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
// Parameter coercion
// ---------------------------------------------------------------------------

interface WasmAnalysis {
  compute?: (...args: unknown[]) => unknown;
  fit?: (...args: unknown[]) => unknown;
  feed?: (frame: Frame) => void;
  free?: () => void;
}

type WasmCtor = new (...args: unknown[]) => WasmAnalysis;

function wasmClass(name: string): WasmCtor {
  const ctor = (molrs as unknown as Record<string, unknown>)[name];
  if (typeof ctor !== "function") {
    throw new Error(`@molcrafts/molvis-core/molrs does not export ${name}`);
  }
  return ctor as WasmCtor;
}

function numbers(value: number | boolean | string): number[] {
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const parsed = Number(part);
      if (!Number.isFinite(parsed)) {
        throw new Error(`"${part}" is not a number`);
      }
      return parsed;
    });
}

function coerce(
  spec: AnalysisParamSpec,
  raw: number | boolean | string | undefined,
): unknown {
  const value = raw ?? spec.default;
  switch (spec.kind) {
    case "int": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${spec.key}: "${String(value)}" is not an integer`);
      }
      return Math.trunc(parsed);
    }
    case "float": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${spec.key}: "${String(value)}" is not a number`);
      }
      return parsed;
    }
    case "bool":
      return value === true || value === "true";
    case "select":
      return String(value);
    case "intList":
      return new Uint32Array(numbers(value));
    case "floatList":
      return new Float64Array(numbers(value));
    case "textList":
      return String(value)
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
  }
}

function ctorArgs(
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
): unknown[] {
  return definition.params
    .filter((spec) => spec.slot === "ctor")
    .map((spec) => coerce(spec, params[spec.key]));
}

function callValue(
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
  key: string,
): unknown {
  const spec = definition.params.find((entry) => entry.key === key);
  if (!spec) throw new Error(`${definition.id}: no parameter named ${key}`);
  return coerce(spec, params[key]);
}

function callNumber(
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
  key: string,
): number {
  return callValue(definition, params, key) as number;
}

// ---------------------------------------------------------------------------
// Per-frame shapes
// ---------------------------------------------------------------------------

/**
 * Build the binding from its `ctor`-slot parameters, in declaration order.
 *
 * Every molrs binding is constructor-configured: `compute` and `fit` take only
 * data. So this is the whole story — no per-analysis construction table.
 */
function instantiate(
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
): WasmAnalysis {
  const Ctor = wasmClass(definition.wasmExport);
  return new Ctor(...ctorArgs(definition, params));
}

/**
 * The `frameRadii` shape — its Voronoi variants differ only in the extra data
 * argument they take beside the frame (none, atom labels, a void mask).
 */
function runFrameRadii(
  frame: Frame,
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
  selected: readonly number[],
): unknown {
  const instance = instantiate(definition, params);
  try {
    switch (definition.id) {
      case VORONOI_RADICAL_ANALYSIS_ID:
        return marshalAnalysisResult(definition.id, instance.compute?.(frame));
      case VORONOI_DOMAIN_ANALYSIS_ID: {
        const labelBy = callValue(definition, params, "labelBy") as string;
        return marshalAnalysisResult(
          definition.id,
          instance.compute?.(frame, atomLabels(frame, labelBy)),
        );
      }
      case VORONOI_VOID_ANALYSIS_ID: {
        const atomCount = frame.getBlock("atoms")?.nrows() ?? 0;
        return marshalAnalysisResult(
          definition.id,
          instance.compute?.(frame, voidMask(atomCount, selected)),
        );
      }
      default:
        throw new AnalysisUnsupportedError(
          definition.id,
          "unknown frameRadii analysis",
        );
    }
  } finally {
    instance.free?.();
  }
}

/**
 * The `frameGroups` shape — bonded pairs, angle triples or dihedral quads read
 * off the frame's bonds block, picked by what the definition requires.
 */
function runFrameGroups(
  frame: Frame,
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
): unknown {
  const groups = definition.requires.includes("atomTriples")
    ? angleTriples(frame)
    : definition.requires.includes("atomQuads")
      ? dihedralQuads(frame)
      : bondPairs(frame);
  if (groups.length === 0) {
    throw new AnalysisUnsupportedError(
      definition.id,
      "the frame's bonds block yields no atom groups",
    );
  }
  const instance = instantiate(definition, params);
  try {
    return marshalAnalysisResult(
      definition.id,
      instance.compute?.(frame, groups),
    );
  } finally {
    instance.free?.();
  }
}

/** Run one frame through a shape that consumes a single `Frame`. */
function runSingleFrame(
  frame: Frame,
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
  selected: readonly number[],
): unknown {
  switch (definition.inputKind) {
    case "frame": {
      const instance = instantiate(definition, params);
      try {
        return marshalAnalysisResult(definition.id, instance.compute?.(frame));
      } finally {
        instance.free?.();
      }
    }
    case "frameNeighbors": {
      const query = new SpatialNeighborQuery(
        callNumber(definition, params, "cutoff"),
      );
      const neighbors = query.build(frame);
      const instance = instantiate(definition, params);
      try {
        return marshalAnalysisResult(
          definition.id,
          instance.compute?.(frame, neighbors),
        );
      } finally {
        instance.free?.();
        neighbors.free();
        query.free();
      }
    }
    case "frameClusters": {
      const query = new SpatialNeighborQuery(
        callNumber(definition, params, "cutoff"),
      );
      const neighbors = query.build(frame);
      const cluster = new Cluster(
        callNumber(definition, params, "minClusterSize"),
      );
      const clusters = cluster.compute(frame, neighbors);
      const instance = instantiate(definition, params);
      try {
        return marshalAnalysisResult(
          definition.id,
          instance.compute?.(frame, clusters),
        );
      } finally {
        instance.free?.();
        clusters.free();
        cluster.free();
        neighbors.free();
        query.free();
      }
    }
    case "frameRadii":
      return runFrameRadii(frame, definition, params, selected);
    case "frameGroups":
      return runFrameGroups(frame, definition, params);
    default:
      throw new AnalysisUnsupportedError(
        definition.id,
        `input kind ${definition.inputKind} is not a per-frame shape`,
      );
  }
}

// ---------------------------------------------------------------------------
// Accumulating and array-driven shapes
// ---------------------------------------------------------------------------

/**
 * A catalog binding driven as an accumulator: built once, fed every visited
 * frame, read out once.
 *
 * Owned by whoever constructs it — {@link runAccumulate} — which is also what
 * calls {@link CatalogAccumulator.dispose}. The frame runner only feeds and
 * reads: releasing a holder of WASM (WebAssembly) handles that it did not build
 * would free memory out from under its owner.
 *
 * Two rules keep that memory from escaping this class. A subset feed builds a
 * sub-frame and frees it in the same call that built it — the rule
 * `MsdAnalyzer.feed` (`./msd`) already follows. And the binding's answer leaves
 * through `marshalAnalysisResult` (`./result_marshal`), which copies an owned
 * result handle's columns out and frees the handle, so what reaches the caller
 * owns no WASM memory at all.
 */
class CatalogAccumulator implements TrajectoryAccumulateSink<unknown> {
  private readonly instance: WasmAnalysis;

  constructor(
    private readonly definition: AnalysisDefinition,
    params: AnalysisParamValues,
  ) {
    this.instance = instantiate(definition, params);
  }

  /**
   * Feed one frame, or just the selected atoms of it — the sub-frame is built
   * and freed here, in this call.
   *
   * @throws AnalysisUnsupportedError when a subset was asked for but the frame
   *   carries no atom coordinates to cut it from
   */
  feed(frame: Frame, atomIndices?: readonly number[]): void {
    if (!atomIndices) {
      this.instance.feed?.(frame);
      return;
    }
    const subFrame = buildAtomSubFrame(frame, atomIndices);
    if (!subFrame) {
      throw new AnalysisUnsupportedError(
        this.definition.id,
        "the frame has no atom coordinates to select from",
      );
    }
    try {
      this.instance.feed?.(subFrame);
    } finally {
      subFrame.free();
    }
  }

  /** What the fed frames add up to, as data that owns no WASM memory. */
  result(): unknown {
    return marshalAnalysisResult(this.definition.id, this.instance.compute?.());
  }

  /** Release the binding. */
  dispose(): void {
    this.instance.free?.();
  }
}

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

const PER_FRAME_KINDS = new Set([
  "frame",
  "frameNeighbors",
  "frameClusters",
  "frameGroups",
  "frameRadii",
]);

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
