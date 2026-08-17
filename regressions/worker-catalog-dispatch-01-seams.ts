/**
 * Public-API lock for the catalog analysis ids and the analysis barrel surface.
 * Goldens are literals: molrs compute catalog 0.13.1, `@molcrafts/molrs@^0.13.1`,
 * read offline 2026-08-14.
 *
 * Run with the repo TS runner: `node regressions/worker-catalog-dispatch-01-seams.ts`
 * after `npm run build:stage`.
 *
 * The two preamble hooks exist only so the published barrel is *evaluable* under
 * node: the bundler-target molrs `.wasm` has no node ESM loader and node has no
 * `HTMLElement` for `stage/dist/ui/base.js`. The `.wasm` stub keeps this script
 * WASM-free — nothing below calls molrs, and no WASM module is instantiated.
 */
import { registerHooks } from "node:module";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

registerHooks({
  load(url, context, next) {
    if (!url.endsWith(".wasm")) return next(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: "export function __wbindgen_start() {}\n",
    };
  },
});

const dom: { HTMLElement?: unknown; customElements?: unknown } = globalThis;
dom.HTMLElement ??= class {};
dom.customElements ??= { define() {}, get: () => undefined };

const stage = await import("../stage/dist/index.js");

assert(
  stage.RDF_ANALYSIS_ID === "rdf.radial_distribution",
  `RDF_ANALYSIS_ID ${stage.RDF_ANALYSIS_ID}`,
);
assert(
  stage.MSD_ANALYSIS_ID === "msd.mean_squared_displacement",
  `MSD_ANALYSIS_ID ${stage.MSD_ANALYSIS_ID}`,
);
assert(
  stage.COM_ANALYSIS_ID === "shape.center_of_mass",
  `COM_ANALYSIS_ID ${stage.COM_ANALYSIS_ID}`,
);

assert(typeof stage.runAnalysis === "function", "runAnalysis left the barrel");
assert(
  typeof stage.expandFrameRange === "function",
  "expandFrameRange left the barrel",
);
assert(
  typeof stage.snapshotFrameForAnalysis === "function",
  "snapshotFrameForAnalysis left the barrel",
);

assert(
  !Object.keys(stage).includes("runAnalysisJob"),
  "public barrel must not expose the worker kernel runAnalysisJob",
);

console.log("worker-catalog-dispatch-01-seams ok");
