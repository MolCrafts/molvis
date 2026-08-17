/**
 * Public-API lock for the worker's snapshot-coverage verdict, plus a source-text
 * lock on the two-entry route table that replaced the worker's two-id menu.
 *
 * Goldens are literals, hand-written from the snapshot contract — no tool, no
 * catalog, no molrs call produced them. An `AnalysisFrameSnapshot` carries
 * x / y / z, `element`, `id` and the cell and nothing else, so: a per-frame or
 * `accumulate` analysis that requires nothing is covered (true, true); `series`
 * wants a per-atom velocity matrix stacked across frames and `frameGroupSets`
 * wants a per-observable group editor, neither of which is snapshot data
 * (false, false); a `velocity` requirement asks for atom columns the snapshot
 * drops (false); and `voidMask` comes from the job's own selection parameter
 * rather than from a frame column (true). Six definitions, six verdicts,
 * recorded 2026-08-14 against `@molcrafts/molvis-stage` at this commit.
 *
 * Run with the repo TS runner: `node regressions/worker-catalog-dispatch-04-dispatch.ts`
 * after `npm run build:stage`.
 *
 * The two preamble hooks are the ones
 * `regressions/worker-catalog-dispatch-01-seams.ts` documents, for the same
 * reason: `snapshotCoversAnalysis` is on the public barrel, and evaluating that
 * barrel under node needs an ESM loader answer for the bundler-target molrs
 * `.wasm` and an `HTMLElement` for `stage/dist/ui/base.js`. The `.wasm` stub is
 * what keeps this script WebAssembly-free — the predicate reads two fields off
 * a plain object, so no WASM module is instantiated, no worker is spawned and
 * no external process runs.
 *
 * The second half reads `stage/src/analysis/job_runner.ts` as text (precedent:
 * `regressions/theme-tab10-ovito-05-page.ts:34-63`). It has to: the deleted
 * `readRdfParams` / `readMsdParams` readers, the retired "not available on the
 * worker" refusal and "the route table has exactly two entries" are all
 * statements about *absence*, and an absence has no runtime surface to call.
 */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AnalysisDefinition,
  AnalysisInputKind,
  AnalysisRequirement,
} from "../stage/dist/index.js";

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

const { snapshotCoversAnalysis } = await import("../stage/dist/index.js");

/**
 * A catalog entry as a hand-written literal.
 *
 * The predicate reads `inputKind` and `requires` only, so the rest is filler
 * that never leaves this file — `wasmExport` in particular names no real molrs
 * class, which is the point: nothing here can reach the catalog by accident.
 */
function definition(
  inputKind: AnalysisInputKind,
  requires: readonly AnalysisRequirement[],
): AnalysisDefinition {
  return {
    id: `regression.${inputKind}`,
    category: "regression",
    label: "regression probe",
    wasmExport: "NeverInstantiated",
    inputKind,
    resultKind: "scalar",
    requires: [...requires],
    params: [],
  };
}

// --- snapshotCoversAnalysis: six definitions, six hard-coded verdicts --------

assert(
  snapshotCoversAnalysis(definition("frame", [])) === true,
  "a per-frame analysis requiring nothing must be covered",
);
assert(
  snapshotCoversAnalysis(definition("accumulate", [])) === true,
  "an accumulate analysis requiring nothing must be covered",
);
assert(
  snapshotCoversAnalysis(definition("series", [])) === false,
  "series needs a stacked velocity matrix the snapshot does not carry",
);
assert(
  snapshotCoversAnalysis(definition("frameGroupSets", [])) === false,
  "frameGroupSets needs group-editor state, which is not frame data",
);
assert(
  snapshotCoversAnalysis(definition("frame", ["velocity"])) === false,
  "velocity columns are not snapshotted",
);
assert(
  snapshotCoversAnalysis(definition("frame", ["voidMask"])) === true,
  "voidMask comes from the job selection, so a snapshot expresses it",
);

// --- job_runner.ts source text: what the route table replaced ---------------

const jobRunner = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../stage/src/analysis/job_runner.ts",
  ),
  "utf8",
);

assert(
  !jobRunner.includes("readRdfParams"),
  "readRdfParams must be gone: its body is inlined into the RDF route entry",
);
assert(
  !jobRunner.includes("readMsdParams"),
  "readMsdParams must be gone: its body is inlined into the MSD route entry",
);
assert(
  !jobRunner.includes("not available on the worker"),
  "the two-id refusal is retired; unsupported analyses are snapshotCoversAnalysis' verdict",
);

const tableName = "const TRAJECTORY_ENTRY_RUNNERS";
const tableAt = jobRunner.indexOf(tableName);
assert(tableAt >= 0, `${tableName} not found in job_runner.ts`);
const bodyAt = jobRunner.indexOf("= {", tableAt);
const bodyEnd = jobRunner.indexOf("\n};", bodyAt);
assert(
  bodyAt > tableAt && bodyEnd > bodyAt,
  "TRAJECTORY_ENTRY_RUNNERS is not a module-level object literal any more",
);
const tableBlock = jobRunner.slice(bodyAt, bodyEnd);

/**
 * Every top-level key of the table block: a computed `[NAME]`, a quoted id, or
 * a bare identifier, each at the two-space indent a module-level literal's
 * entries sit at. Entry bodies and comments are indented deeper, so they cannot
 * be miscounted as keys.
 */
const keys = [
  ...tableBlock.matchAll(
    /^ {2}(\[[A-Za-z0-9_$]+\]|"[^"]*"|[A-Za-z_$][\w$]*)\s*:/gm,
  ),
].map((match) => match[1]);

assert(
  keys.includes("[RDF_ANALYSIS_ID]"),
  `RDF_ANALYSIS_ID is not a route key: ${keys.join(" ")}`,
);
assert(
  keys.includes("[MSD_ANALYSIS_ID]"),
  `MSD_ANALYSIS_ID is not a route key: ${keys.join(" ")}`,
);
assert(
  keys.length === 2,
  `the route table is closed at two entries, found ${keys.length}: ${keys.join(" ")}`,
);

console.log("worker-catalog-dispatch-04-dispatch ok");
