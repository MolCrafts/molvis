/**
 * Contract lock for the analysis result marshalling table: a listed id gets its
 * columns copied and its handle freed exactly once, an unlisted id passes
 * straight through by reference.
 *
 * Goldens are literals transcribed from the `dispatch.normalizeResult` branches
 * this table replaced (molrs compute catalog 0.13.1,
 * `@molcrafts/molrs@^0.13.1`, read offline 2026-08-14): rdf `binCenters`
 * [0.5, 1.5], `numPoints` 2, `rMin` 0, `volume` 8000.
 *
 * Run with the repo TS runner: `node regressions/worker-catalog-dispatch-02-marshal.ts`
 * after `npm run build:stage`.
 *
 * `result_marshal` is a kernel seam and by invariant is on no public barrel, so
 * it is pinned here at its build-output deep path — same convention as
 * `regressions/theme-tab10-ovito-02-wire.ts`. That import is also why this
 * script needs no loader shim: the module's whole runtime closure is
 * `analysis_ids` plus `trajectory_runner` → `utils/dtype` + `utils/yield_ui`,
 * none of which import molrs. Every handle below is a plain object; no WASM
 * (WebAssembly) module is instantiated and no molrs call is made.
 */
import { marshalAnalysisResult } from "../stage/dist/analysis/result_marshal.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function sameNumbers(a: Float64Array, b: readonly number[]): boolean {
  return a.length === b.length && b.every((v, i) => a[i] === v);
}

/** The plain-data shape the rdf entry must hand back. */
interface RdfPayload {
  binCenters: Float64Array;
  binEdges: Float64Array;
  rdf: Float64Array;
  pairCounts: Float64Array;
  numPoints: number;
  rMin: number;
  volume: number;
}

/** Hand-written stand-in for `molrs.RDFResult` — getters plus a free counter. */
class FakeRdfResult {
  freeCalls = 0;
  readonly numPoints = 2;
  readonly rMin = 0;
  readonly volume = 8000;

  binCenters(): Float64Array {
    return Float64Array.from([0.5, 1.5]);
  }

  binEdges(): Float64Array {
    return Float64Array.from([0, 1, 2]);
  }

  rdf(): Float64Array {
    return Float64Array.from([0.25, 1.75]);
  }

  pairCounts(): Float64Array {
    return Float64Array.from([3, 11]);
  }

  free(): void {
    this.freeCalls += 1;
  }
}

/** An unlisted id's result: every member logs, so "untouched" is assertable. */
class SentinelPayload {
  readonly calls: string[] = [];

  free(): void {
    this.calls.push("free");
  }

  compute(): void {
    this.calls.push("compute");
  }

  toJSON(): void {
    this.calls.push("toJSON");
  }
}

const handle = new FakeRdfResult();
const payload = marshalAnalysisResult(
  "rdf.radial_distribution",
  handle,
) as RdfPayload;

assert(
  sameNumbers(payload.binCenters, [0.5, 1.5]),
  `binCenters ${payload.binCenters}`,
);
assert(
  sameNumbers(payload.binEdges, [0, 1, 2]),
  `binEdges ${payload.binEdges}`,
);
assert(sameNumbers(payload.rdf, [0.25, 1.75]), `rdf ${payload.rdf}`);
assert(
  sameNumbers(payload.pairCounts, [3, 11]),
  `pairCounts ${payload.pairCounts}`,
);
assert(payload.numPoints === 2, `numPoints ${payload.numPoints}`);
assert(payload.rMin === 0, `rMin ${payload.rMin}`);
assert(payload.volume === 8000, `volume ${payload.volume}`);

// Field set is part of the contract: nothing extra, nothing dropped.
assert(
  Object.keys(payload).sort().join(",") ===
    "binCenters,binEdges,numPoints,pairCounts,rMin,rdf,volume",
  `rdf payload fields ${Object.keys(payload).sort().join(",")}`,
);

// Copy-then-free is the table's contract; twice would double-free a real handle.
assert(handle.freeCalls === 1, `rdf free() calls ${handle.freeCalls}`);

// Default pass-through: adding a catalog analysis needs no edit to the table.
const sentinel = new SentinelPayload();
const passed = marshalAnalysisResult("voronoi.radical_voronoi", sentinel);

assert(
  passed === sentinel,
  "unlisted id must return the same object reference",
);
assert(
  sentinel.calls.length === 0,
  `unlisted id payload was touched: ${sentinel.calls.join(",")}`,
);

console.log("worker-catalog-dispatch-02-marshal ok");
