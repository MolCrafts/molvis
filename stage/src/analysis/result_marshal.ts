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

interface ShapedJson {
  dim: number[];
  data: number[];
}

function isShaped(value: unknown): value is ShapedJson {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as ShapedJson).dim) &&
    Array.isArray((value as ShapedJson).data)
  );
}

function isHandle(value: unknown): value is ResultHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ResultHandle).toJSON === "function" &&
    typeof (value as ResultHandle).free === "function"
  );
}

/** A result's fields with every shaped array flattened, plus its shapes. */
export type MarshalledResult = Record<string, unknown> & {
  shapes: Record<string, number[]>;
  shape?: number[];
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
