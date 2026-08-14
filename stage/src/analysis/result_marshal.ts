/**
 * The shape a molrs result takes on its way out of an analysis run.
 *
 * molrs is the Rust/WebAssembly (WASM) molecular core this package computes
 * with, and its *compute catalog* is the list of analyses it exposes to
 * JavaScript (`./registry` wraps it). A handful of those catalog bindings hand
 * back an owned WASM result class instead of plain data: reading one means
 * copying its columns into a JavaScript object and freeing the handle, and the
 * field set differs per analysis. This module is the single place that knows
 * those field sets — a readonly table keyed by catalog id plus
 * {@link marshalAnalysisResult} to apply it. Every id the table does not list
 * passes through untouched, so adding a catalog analysis needs no edit here.
 *
 * **Temporary seam.** The molrs 0.13.1 compute catalog carries no
 * result-serialization metadata, so these shapes have to be spelled out on
 * this side of the boundary. When molrs unifies its result surfaces the table
 * shrinks to empty and this module is deleted — so keep it a closed set: no
 * `register()`, no host-supplied entries, nothing that would make deleting it
 * a breaking change. It has shrunk once already: the MSD entry left when
 * `MsdAnalyzer` (`./msd`) became the only driver of that analysis, since it
 * copies and frees its own result handles.
 *
 * Imports are `./analysis_ids` and one error class, deliberately: result
 * shapes are needed wherever an analysis runs — main thread or analysis Web
 * Worker (a browser background thread with no page and no renderer) — and the
 * tests drive this module with hand-written fake handles, with no WASM in
 * sight.
 */

import {
  CLUSTER_ANALYSIS_ID,
  COM_ANALYSIS_ID,
  RDF_ANALYSIS_ID,
} from "./analysis_ids";
import { AnalysisUnsupportedError } from "./trajectory_runner";

// ---------------------------------------------------------------------------
// Owned result handles — the molrs classes this table serializes
// ---------------------------------------------------------------------------

/**
 * Structural, not imported from molrs: the table only ever reads these getters
 * and then frees, and typing them here is what keeps the module WASM-free.
 */
interface OwnedResult {
  free(): void;
}

/**
 * `molrs.RDFResult` — the four binned columns of an RDF (radial distribution
 * function: how atom density varies with distance from an atom) plus the run's
 * scalars.
 */
interface RdfResult extends OwnedResult {
  binCenters(): Float64Array;
  binEdges(): Float64Array;
  rdf(): Float64Array;
  pairCounts(): Float64Array;
  readonly numPoints: number;
  readonly rMin: number;
  readonly volume: number;
}

/** `molrs.ClusterResult` — sizes per cluster, cluster index per atom. */
interface ClusterResult extends OwnedResult {
  clusterSizes(): Uint32Array;
  clusterIdx(): Int32Array;
  readonly numClusters: number;
}

/** `molrs.CenterOfMassResult` — flat `[x, y, z, …]` centers plus masses. */
interface CenterOfMassResult extends OwnedResult {
  centersOfMass(): Float64Array;
  clusterMasses(): Float64Array;
  readonly numClusters: number;
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
      numPoints: result.numPoints,
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
      numClusters: result.numClusters,
    };
    result.free();
    return payload;
  },
  [COM_ANALYSIS_ID]: (raw) => {
    const result = raw as CenterOfMassResult;
    const payload = {
      centersOfMass: result.centersOfMass(),
      clusterMasses: result.clusterMasses(),
      numClusters: result.numClusters,
    };
    result.free();
    return payload;
  },
};

/**
 * Turn `raw` — whatever the binding for `analysisId` just returned — into a
 * payload that owns no WASM memory.
 *
 * @param analysisId catalog id of the analysis that produced `raw`
 * @param raw the binding's return value — an owned handle for a listed id,
 *   anything at all for an unlisted one
 * @returns plain data for a listed id, `raw` itself by reference for any other
 * @throws AnalysisUnsupportedError when a listed id's binding returned
 *   something that is not a handle object — `undefined`, `null`, a number. Its
 *   columns cannot be read, and naming the analysis here beats a `Cannot read
 *   properties of undefined` several frames away.
 * @example
 * ```ts
 * // `./dispatch`, inside the `try` that owns the binding — the columns are
 * // copied before the matching `finally` frees it.
 * return marshalAnalysisResult(definition.id, instance.compute?.(frame));
 * ```
 */
export function marshalAnalysisResult(
  analysisId: string,
  raw: unknown,
): unknown {
  // Own-property check, not a truthy lookup: an id spelled like an
  // `Object.prototype` member would otherwise resolve to a built-in method.
  if (!Object.hasOwn(ANALYSIS_RESULT_MARSHALLERS, analysisId)) return raw;
  if (typeof raw !== "object" || raw === null) {
    throw new AnalysisUnsupportedError(
      analysisId,
      `its binding returned ${raw === null ? "null" : typeof raw} where a result handle was expected`,
    );
  }
  return ANALYSIS_RESULT_MARSHALLERS[analysisId](raw);
}
