/**
 * Panel-converge lock (spec `worker-catalog-dispatch-06-panels`, ac-008): the
 * Generic panel submits through the worker seam while keeping the main route and
 * the COM / Rg pipeline short-circuit; RdfPanel / MsdPanel dropped their
 * hand-rolled snapshot loops and their id literals; LeftSidebar dropped the
 * literals too; the two display lookup tables keep theirs on purpose.
 *
 * The wiring is locked by *source text*: page components are browser-only React
 * and cannot be instantiated under node — same precedent and technique as
 * `regressions/theme-tab10-ovito-05-page.ts`.
 *
 * Goldens are hard-coded literals, no live oracle: molrs compute catalog 0.13.1
 * (`@molcrafts/molrs@^0.13.1`), read offline 2026-08-14 — same batch as
 * `regressions/worker-catalog-dispatch-01-seams.ts`.
 *
 * Run with the repo TS runner after `npm run build:stage`:
 *   `node regressions/worker-catalog-dispatch-06-panels.ts`
 *
 * The preamble hooks near the bottom exist only so the published barrel is
 * *evaluable* under node: the bundler-target molrs `.wasm` has no node ESM loader
 * and node has no `HTMLElement` for `stage/dist/ui/base.js`. The `.wasm` stub keeps
 * this script WASM-free — nothing below calls molrs, no WASM module is
 * instantiated, no worker is spawned, no third-party process runs.
 */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Hard-coded goldens — molrs compute catalog 0.13.1, read offline 2026-08-14. */
const RDF_ID = "rdf.radial_distribution";
const MSD_ID = "msd.mean_squared_displacement";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const root = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

const generic = read("../page/src/ui/layout/analysis/GenericAnalysisPanel.tsx");

assert(
  generic.includes("planAnalysisRun"),
  "GenericAnalysisPanel must route through planAnalysisRun",
);
assert(
  generic.includes("runAnalysisOnWorker"),
  "GenericAnalysisPanel must submit worker runs via runAnalysisOnWorker",
);
assert(
  generic.includes("snapshotFramesForAnalysis"),
  "GenericAnalysisPanel must pack frames with snapshotFramesForAnalysis",
);
assert(
  generic.includes("wireAtomSelection"),
  "GenericAnalysisPanel must wire the selection with wireAtomSelection",
);
// A bare `runAnalysis` substring would be satisfied by `runAnalysisOnWorker` and
// by the prose comment beside it, so lock the *call*: `runAnalysis(` and never
// `runAnalysisOnWorker(`.
assert(
  /\brunAnalysis\s*\(/.test(generic),
  "GenericAnalysisPanel lost the main-route runAnalysis( call — it is kept on purpose (ac-004), not dead code",
);
assert(
  generic.includes("isComAnalysisId"),
  "GenericAnalysisPanel lost the COM / Rg pipeline short-circuit (Canvas WYSIWYG = SceneIndex, ac-005)",
);

const panels = [
  [
    "RdfPanel",
    read("../page/src/ui/layout/analysis/RdfPanel.tsx"),
    "RDF_ANALYSIS_ID",
  ],
  [
    "MsdPanel",
    read("../page/src/ui/layout/analysis/MsdPanel.tsx"),
    "MSD_ANALYSIS_ID",
  ],
] as const;

for (const [name, src, idConstant] of panels) {
  assert(
    !src.includes("expandFrameRange("),
    `${name} still expands the frame range itself — the snapshot loop moved to snapshotFramesForAnalysis`,
  );
  assert(
    src.includes("snapshotFramesForAnalysis"),
    `${name} must pack frames with snapshotFramesForAnalysis`,
  );
  assert(
    !src.includes(RDF_ID),
    `${name} must not hard-code the ${RDF_ID} dispatch identity`,
  );
  assert(
    !src.includes(MSD_ID),
    `${name} must not hard-code the ${MSD_ID} dispatch identity`,
  );
  assert(
    src.includes(idConstant),
    `${name} must reference the stage ${idConstant} constant instead`,
  );
}

const sidebar = read("../page/src/ui/layout/LeftSidebar.tsx");
assert(
  !sidebar.includes(RDF_ID) && !sidebar.includes(MSD_ID),
  "LeftSidebar's PANEL_ANALYSIS_IDS / OWNS_ATOM_SCOPE must not hard-code the id literals",
);
assert(
  sidebar.includes("RDF_ANALYSIS_ID") && sidebar.includes("MSD_ANALYSIS_ID"),
  "LeftSidebar must reference the stage id constants instead",
);

// The other direction of the same decision: these two are whole-catalog display
// lookups whose keys are data, not dispatch identity — the literals stay, and this
// lock stops the next reader from "finishing" the converge.
const lookups = [
  [
    "useAnalysisCatalog",
    read("../page/src/ui/layout/analysis/useAnalysisCatalog.ts"),
  ],
  ["molpy-docs", read("../page/src/lib/molpy-docs.ts")],
] as const;

for (const [name, src] of lookups) {
  assert(
    src.includes(`"${RDF_ID}"`),
    `${name} must keep its literal "${RDF_ID}" record key (deliberate retention, ac-006)`,
  );
  assert(
    src.includes(`"${MSD_ID}"`),
    `${name} must keep its literal "${MSD_ID}" record key (deliberate retention, ac-006)`,
  );
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

// The names the page now references resolve to exactly the golden strings the
// literals used to spell out.
assert(
  stage.RDF_ANALYSIS_ID === RDF_ID,
  `RDF_ANALYSIS_ID ${stage.RDF_ANALYSIS_ID}`,
);
assert(
  stage.MSD_ANALYSIS_ID === MSD_ID,
  `MSD_ANALYSIS_ID ${stage.MSD_ANALYSIS_ID}`,
);

console.log("worker-catalog-dispatch-06-panels ok");
