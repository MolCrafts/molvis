/**
 * Cross-boundary lock for the staged-optimize copy.
 *
 * The post-run hint "Optimized — Ctrl+S to save" is written twice on purpose:
 * once in the page copy module (`page/src/lib/optimize-staging-copy.ts`) and
 * once on the stage side (`stage/src/optimize/structure.ts`, `STAGED_HINT`),
 * which sends it as the persistent `info-text-change` line so VSCode and
 * Python show the same standing hint. Neither package may depend on the
 * other's internals for a string, so nothing but this script notices when one
 * copy is edited and the other is not.
 *
 * Goldens are literals typed in here — the exact UI copy the spec fixed. No
 * tool, oracle or capture produced them:
 *
 * - `Optimized — Ctrl+S to save` — em dash U+2014, not a hyphen and not an en
 *   dash. The character is the whole point of a byte-for-byte lock: a hyphen
 *   slip renders as different copy on every host and no unit test that quotes
 *   the constant (rather than the literal) can see it.
 * - `Save or discard your canvas edits before optimizing` — the pre-run gate,
 *   about the user's own canvas edits.
 * - `Save scene before optimizing` — the retired wording. Once optimize
 *   results are staged, "unsaved" also means "a result is waiting", so this
 *   string must not survive anywhere in the panel.
 *
 * Reads source and build output only: no React render, no WASM, no worker, no
 * subprocess, no third-party tool.
 *
 * Run: `npm run build:stage` first (this reads `stage/dist`), then
 * `node regressions/optimize-staging-05-panel.ts`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const root = dirname(fileURLToPath(import.meta.url));

const read = (relative: string): string =>
  readFileSync(join(root, relative), "utf8");

/** Post-run: the result is staged in the workspace until the user saves. */
const SAVE_HINT = "Optimized — Ctrl+S to save";
/** Pre-run gate: the user's own canvas edits. */
const DIRTY_GATE_HINT = "Save or discard your canvas edits before optimizing";
/** The wording the staging inversion retired. */
const RETIRED_GATE = "Save scene before optimizing";

// --- Page side: the copy module owns both sentences -------------------------

const copyModule = read("../page/src/lib/optimize-staging-copy.ts");
assert(
  copyModule.includes(SAVE_HINT),
  `page/src/lib/optimize-staging-copy.ts lost the staged hint "${SAVE_HINT}"`,
);
assert(
  copyModule.includes(DIRTY_GATE_HINT),
  `page/src/lib/optimize-staging-copy.ts lost the gate hint "${DIRTY_GATE_HINT}"`,
);
assert(
  !copyModule.includes(RETIRED_GATE),
  `page/src/lib/optimize-staging-copy.ts still carries the retired "${RETIRED_GATE}"`,
);

// --- Panel side: it uses the module and no longer hard-codes the old gate ---

const panel = read("../page/src/ui/layout/StructureOptimizePanel.tsx");
assert(
  panel.includes("optimize-staging-copy"),
  "page/src/ui/layout/StructureOptimizePanel.tsx no longer imports the copy module",
);
assert(
  panel.includes("OPTIMIZE_DIRTY_GATE_HINT"),
  "StructureOptimizePanel.tsx does not use OPTIMIZE_DIRTY_GATE_HINT for the gate",
);
assert(
  panel.includes("optimizeStagedLine"),
  "StructureOptimizePanel.tsx does not use optimizeStagedLine for the completion line",
);
assert(
  !panel.includes(RETIRED_GATE),
  `StructureOptimizePanel.tsx still says "${RETIRED_GATE}"`,
);

// --- Stage side: the same literal ships in the build output ------------------

const structureJs = read("../stage/dist/optimize/structure.js");
assert(
  structureJs.includes(SAVE_HINT),
  `stage/dist/optimize/structure.js lost the staged hint "${SAVE_HINT}" — page and stage copy have drifted (rebuild with npm run build:stage if this dist is stale)`,
);
assert(
  !structureJs.includes(RETIRED_GATE),
  `stage/dist/optimize/structure.js still says "${RETIRED_GATE}"`,
);

console.log("optimize-staging-05-panel ok");
