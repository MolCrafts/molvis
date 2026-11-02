/**
 * The shape a molrs result takes on its way out of an analysis run.
 *
 * Every molrs compute returns an owned result handle named after its output
 * type (`RdfResult`, `ClusterResult`, `TimeCorrelation`, …). Its `toJSON()` is
 * the data: snake_case fields, every array as `{ v, dim, data }`. Reading one
 * here means copying that data out and freeing the handle, so what leaves an
 * analysis run owns no WASM memory and survives `postMessage`.
 *
 * One rule for every compute — no per-analysis table: each top-level
 * `{ dim, data }` field becomes a `Float64Array` of its data, with its shape
 * kept in `shapes[field]`, and `shape` names the first multi-dimensional one
 * (what a matrix renderer reads). A handle that derives a value outside its
 * `toJSON()` (`GyrationTensorResult.radiusOfGyration()`) contributes it under
 * the snake_case name.
 *
 * Imports one error class, deliberately: the tests drive this module with
 * hand-written fake handles, with no WASM in sight.
 */

import { AnalysisUnsupportedError } from "./trajectory_runner";

/** The handle surface this module reads, structurally. */
interface ResultHandle {
  toJSON(): unknown;
  free(): void;
  radiusOfGyration?: () => Float64Array;
}

/**
 * `molrs.RdfResult` — the four binned columns of an RDF (radial distribution
 * function: how atom density varies with distance from an atom) plus the run's
 * scalars.
 */
interface RdfResult extends OwnedResult {
  binCenters(): Float64Array;
  binEdges(): Float64Array;
  rdf(): Float64Array;
  pairCounts(): Float64Array;
  readonly nPoints: number;
  readonly rMin: number;
  readonly volume: number;
}

/** `molrs.ClusterResult` — sizes per cluster, cluster index per atom. */
interface ClusterResult extends OwnedResult {
  clusterSizes(): Uint32Array;
  clusterIdx(): Int32Array;
  readonly nClusters: number;
}

/** `molrs.CenterOfMassResult` — flat `[x, y, z, …]` centers plus masses. */
interface CenterOfMassResult extends OwnedResult {
  centersOfMass(): Float64Array;
  clusterMasses(): Float64Array;
  readonly nClusters: number;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** Copy an owned result's columns out, free the handle, return plain data. */
type AnalysisResultMarshaller = (raw: object) => unknown;

/**
 * Per-id result serialization, keyed by the constants in `./analysis_ids`.
 *
 * Exported so the unit tests can drive each entry directly; production code
 * goes through {@link marshalAnalysisResult}, which adds the default
 * pass-through and the malformed-handle guard.
 */
export const ANALYSIS_RESULT_MARSHALLERS: Readonly<
  Record<string, AnalysisResultMarshaller>
> = {
  [RDF_ANALYSIS_ID]: (raw) => {
    const result = raw as RdfResult;
    const payload = {
      binCenters: result.binCenters(),
      binEdges: result.binEdges(),
      rdf: result.rdf(),
      pairCounts: result.pairCounts(),
      numPoints: result.nPoints,
      rMin: result.rMin,
      volume: result.volume,
    };
    result.free();
    return payload;
  },
  [CLUSTER_ANALYSIS_ID]: (raw) => {
    const result = raw as ClusterResult;
    const payload = {
      clusterSizes: result.clusterSizes(),
      clusterIdx: result.clusterIdx(),
      numClusters: result.nClusters,
    };
    result.free();
    return payload;
  },
  [COM_ANALYSIS_ID]: (raw) => {
    const result = raw as CenterOfMassResult;
    const payload = {
      centersOfMass: result.centersOfMass(),
      clusterMasses: result.clusterMasses(),
      numClusters: result.nClusters,
    };
    result.free();
    return payload;
  },
};

/**
 * Copy `raw` — the handle a molrs `compute` returned for `analysisId` — into
 * plain data and free it.
 *
 * @param analysisId catalog id, named in the error when `raw` is no handle
 * @param raw the compute's return value
 * @returns the result's fields, shaped arrays as `Float64Array`
 * @throws AnalysisUnsupportedError when `raw` is not a result handle — its
 *   data cannot be read, and naming the analysis here beats a `Cannot read
 *   properties of undefined` several frames away
 * @example
 * ```ts
 * const rdf = marshalAnalysisResult(id, new Rdf(100, 10, 0).compute(frames));
 * rdf.rdf; // Float64Array
 * rdf.shapes.rdf; // [100]
 * ```
 */
export function marshalAnalysisResult(
  analysisId: string,
  raw: unknown,
): MarshalledResult {
  if (!isHandle(raw)) {
    throw new AnalysisUnsupportedError(
      analysisId,
      `its compute returned ${raw === null ? "null" : typeof raw} where a result handle was expected`,
    );
  }
  try {
    const json = raw.toJSON() as Record<string, unknown>;
    const shapes: Record<string, number[]> = {};
    const fields: Record<string, unknown> = {};
    let shape: number[] | undefined;
    for (const [key, value] of Object.entries(json)) {
      if (isShaped(value)) {
        fields[key] = Float64Array.from(value.data);
        shapes[key] = [...value.dim];
        if (!shape && value.dim.length > 1) shape = [...value.dim];
      } else {
        fields[key] = value;
      }
    }
    if (typeof raw.radiusOfGyration === "function") {
      fields.radius_of_gyration = Float64Array.from(raw.radiusOfGyration());
    }
    return { ...fields, shapes, ...(shape ? { shape } : {}) };
  } finally {
    raw.free();
  }
}
