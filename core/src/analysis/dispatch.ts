import * as molrs from "@molcrafts/molrs";
import { Cluster, type Frame, LinkedCell } from "@molcrafts/molrs";
import type { Trajectory } from "../system/trajectory";
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
import {
  type AnalysisAtomSelection,
  type AnalysisFrameFailure,
  type AnalysisProgress,
  expandFrameRange,
  type FrameRange,
  resolveTrackedAtomIndices,
  resolveTrackedAtomSelection,
  type TrackedAtomSelection,
} from "./trajectory_runner";

/**
 * Dispatch an analysis by its catalog `inputKind`, never by its id.
 *
 * Every molrs binding is constructor-configured — `compute` and `fit` take only
 * data — so building one is always `new Ctor(...ctorSlotParams)`. A `call`-slot
 * parameter configures a *different* object this module builds first: the
 * neighbor `cutoff` belongs to `LinkedCell`, `minClusterSize` to `Cluster`,
 * `resolution` to an upstream flux stage, `labelBy` picks the column that
 * becomes a `labels` data argument.
 */

export type AnalysisParamValues = Record<string, number | boolean | string>;

/** Raised when the catalog describes a shape this build cannot drive. */
export class AnalysisUnsupportedError extends Error {
  constructor(
    readonly analysisId: string,
    reason: string,
  ) {
    super(`${analysisId} cannot run: ${reason}`);
    this.name = "AnalysisUnsupportedError";
  }
}

export interface AnalysisRunOptions {
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
  results?: () => unknown;
  free?: () => void;
}

type WasmCtor = new (...args: unknown[]) => WasmAnalysis;

function wasmClass(name: string): WasmCtor {
  const ctor = (molrs as unknown as Record<string, unknown>)[name];
  if (typeof ctor !== "function") {
    throw new Error(`@molcrafts/molrs does not export ${name}`);
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

function runFrameRadii(
  frame: Frame,
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
  selected: readonly number[],
): unknown {
  const instance = instantiate(definition, params);
  try {
    switch (definition.id) {
      case "voronoi.radical_voronoi":
        return instance.compute?.(frame);
      case "voronoi.domain_analysis": {
        const labelBy = callValue(definition, params, "labelBy") as string;
        return instance.compute?.(frame, atomLabels(frame, labelBy));
      }
      case "voronoi.void_analysis": {
        const atomCount = frame.getBlock("atoms")?.nrows() ?? 0;
        return instance.compute?.(frame, voidMask(atomCount, selected));
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
    return instance.compute?.(frame, groups);
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
        return instance.compute?.(frame);
      } finally {
        instance.free?.();
      }
    }
    case "frameNeighbors": {
      const cell = new LinkedCell(callNumber(definition, params, "cutoff"));
      const neighbors = cell.build(frame);
      const instance = instantiate(definition, params);
      try {
        return normalizeResult(
          definition.id,
          instance.compute?.(frame, neighbors),
        );
      } finally {
        instance.free?.();
        neighbors.free();
        cell.free();
      }
    }
    case "frameClusters": {
      const cell = new LinkedCell(callNumber(definition, params, "cutoff"));
      const neighbors = cell.build(frame);
      const cluster = new Cluster(
        callNumber(definition, params, "minClusterSize"),
      );
      const clusters = cluster.compute(frame, neighbors);
      const instance = instantiate(definition, params);
      try {
        const raw = instance.compute?.(frame, clusters);
        return definition.id === "shape.center_of_mass"
          ? centersOfMassPayload(raw)
          : raw;
      } finally {
        instance.free?.();
        clusters.free();
        cluster.free();
        neighbors.free();
        cell.free();
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

function centersOfMassPayload(raw: unknown): unknown {
  const result = raw as molrs.CenterOfMassResult;
  const payload = {
    centersOfMass: result.centersOfMass(),
    clusterMasses: result.clusterMasses(),
    numClusters: result.numClusters,
  };
  result.free();
  return payload;
}

/**
 * A handful of bindings return owned WASM result classes rather than a plain
 * serialized object. Copy their columns out and free the handle here, so a
 * payload leaving this module is always inert plain data.
 */
function normalizeResult(analysisId: string, raw: unknown): unknown {
  if (analysisId === "rdf.radial_distribution") {
    const result = raw as molrs.RDFResult;
    const payload = {
      binCenters: result.binCenters(),
      binEdges: result.binEdges(),
      rdf: result.rdf(),
      pairCounts: result.pairCounts(),
      numPoints: result.numPoints,
      rMin: result.rMin,
      volume: result.volume,
    };
    result.free();
    return payload;
  }
  if (analysisId === "cluster.connected_components") {
    const result = raw as molrs.ClusterResult;
    const payload = {
      clusterSizes: result.clusterSizes(),
      clusterIdx: result.clusterIdx(),
      numClusters: result.numClusters,
    };
    result.free();
    return payload;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Accumulating and array-driven shapes
// ---------------------------------------------------------------------------

async function runAccumulate(
  options: AnalysisRunOptions,
  frameIndices: number[],
): Promise<unknown> {
  const { definition, params, trajectory } = options;
  const instance = instantiate(definition, params);
  try {
    for (let ordinal = 0; ordinal < frameIndices.length; ordinal++) {
      if (options.abortSignal?.aborted)
        throw new Error("Analysis run was aborted");
      const frameIndex = frameIndices[ordinal];
      instance.feed?.(await trajectory.frame(frameIndex));
      options.onProgress?.({
        completed: ordinal + 1,
        total: frameIndices.length,
        frameIndex,
      });
    }
    if (definition.id === "msd.mean_squared_displacement") {
      const results = instance.results?.() as molrs.MSDResult[];
      const payload = results.map((entry) => {
        const value = { mean: entry.mean, perParticle: entry.perParticle() };
        entry.free();
        return value;
      });
      return payload;
    }
    return instance.compute?.();
  } finally {
    instance.free?.();
  }
}

/**
 * Stack a per-atom vector column across the visited frames into the
 * `(nFrames × 3·nAtoms)` matrix the transport kernels bin over.
 */
async function stackVectorColumns(
  options: AnalysisRunOptions,
  frameIndices: number[],
  columns: readonly string[],
  tracked: TrackedAtomSelection,
): Promise<{ data: Float64Array; nFrames: number; nDof: number }> {
  const rows: Float64Array[] = [];
  let nDof = 0;
  for (const frameIndex of frameIndices) {
    if (options.abortSignal?.aborted)
      throw new Error("Analysis run was aborted");
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
  options: AnalysisRunOptions,
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

  if (definition.id === "spectroscopy.power_spectrum") {
    // VDOS is the power spectrum of the raw velocity ACF. `resolution` is a
    // call-slot knob precisely because it configures this upstream VACF stage,
    // not the spectrum object.
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

/**
 * Run `definition` over the trajectory's `frameRange`, tracking the atoms
 * picked in the reference frame across every visited frame.
 *
 * Per-frame shapes produce one payload per frame; accumulators and
 * array-driven shapes produce a single payload for the whole range.
 */
export async function runAnalysis(
  options: AnalysisRunOptions,
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

  const referenceFrame = await trajectory.frame(frameIndices[0]);
  const tracked = resolveTrackedAtomSelection(
    referenceFrame,
    options.selection,
    frameIndices[0],
  );

  if (definition.inputKind === "accumulate") {
    return {
      analysisId: definition.id,
      resultKind: definition.resultKind,
      frameIndices,
      payload: await runAccumulate(options, frameIndices),
      perFrame: false,
      failures,
      trackedSelection: tracked,
    };
  }

  if (definition.inputKind === "series") {
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

  const payload: Array<{ frameIndex: number; value: unknown }> = [];
  const visited: number[] = [];
  for (let ordinal = 0; ordinal < frameIndices.length; ordinal++) {
    if (options.abortSignal?.aborted)
      throw new Error("Analysis run was aborted");
    const frameIndex = frameIndices[ordinal];
    try {
      const frame = await trajectory.frame(frameIndex);
      const resolved = resolveTrackedAtomIndices(frame, tracked);
      if (!resolved.ok) {
        throw new Error(
          `tracked atom selection is not valid for frame ${frameIndex}`,
        );
      }
      payload.push({
        frameIndex,
        value: runSingleFrame(
          frame,
          definition,
          options.params,
          resolved.indices,
        ),
      });
      visited.push(frameIndex);
    } catch (error) {
      failures.push({
        frameIndex,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    } finally {
      options.onProgress?.({
        completed: ordinal + 1,
        total: frameIndices.length,
        frameIndex,
      });
    }
  }

  return {
    analysisId: definition.id,
    resultKind: definition.resultKind,
    frameIndices: visited,
    payload,
    perFrame: true,
    failures,
    trackedSelection: tracked,
  };
}
