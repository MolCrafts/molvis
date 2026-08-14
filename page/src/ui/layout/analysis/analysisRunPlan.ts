/**
 * Which of three execution paths one analysis run takes.
 *
 * The vocabulary first, because none of it is standard web wording. An
 * **analysis** is one entry of the *compute catalog*: the list of measurements
 * published by molrs — the Rust molecular core molvis computes with, compiled
 * to WASM (WebAssembly, the browser's binary code format) — each described by
 * an `AnalysisDefinition`, which names its id, the data shape it consumes and
 * what it requires of a frame. The **pipeline** is molvis' ordered chain of
 * modifiers that turns the loaded frames into what the canvas draws. The
 * **compute worker** is the single background thread (a Web Worker) that long
 * computations are handed to, so the tab keeps painting while they run.
 *
 * Those three — pipeline, worker, main thread — are where a panel can send a
 * run, and choosing between them is the whole content of this module. It is a
 * module rather than a branch inside `GenericAnalysisPanel` so the decision can
 * be exhausted by a unit test that mounts no React, boots no worker and loads
 * no WASM: a page component test cannot inject a fake compute host, so a router
 * living inside the component would be provable only by really running an
 * analysis.
 *
 * Nothing here reads application state: a route is a property of the catalog
 * entry alone, so the same analysis always takes the same path.
 *
 * @module
 */

import {
  type AnalysisDefinition,
  isComAnalysisId,
  isRgAnalysisId,
  snapshotCoversAnalysis,
} from "@molcrafts/molvis-stage";

/**
 * The path one analysis run takes.
 *
 * - `pipeline` — install the analysis' pipeline modifier, redraw, and read the
 *   result back off the frame the canvas now shows.
 * - `worker` — copy the run's frames into *snapshots* (plain coordinate,
 *   element and cell arrays: a molrs object is a handle into this thread's
 *   WebAssembly memory and means nothing in another thread, so only plain data
 *   can cross `postMessage`) and submit one job to the shared compute worker.
 * - `main` — run it here on the main thread, against the live trajectory.
 */
export type AnalysisRunRoute = "pipeline" | "worker" | "main";

/** The verdict {@link planAnalysisRun} returns for one catalog entry. */
export interface AnalysisRunPlan {
  /** Where a run of that entry goes. */
  route: AnalysisRunRoute;
}

/**
 * Decide which of the three paths `definition` runs on.
 *
 * The order of the checks is product semantics, not an optimization:
 *
 * 1. **Pipeline first.** Center of mass (COM: the mass-weighted average atom
 *    position) and cluster properties — the radius of gyration (Rg: how far a
 *    cluster's atoms spread around its COM) the panel surfaces — are
 *    expressible as a snapshot job, and must still not become one: their table
 *    is read back off the very frame their modifier just drew, while a worker
 *    would cluster a second time from its own copy of that frame. Two sources
 *    of truth for one on-screen table is the Canvas WYSIWYG = SceneIndex
 *    invariant broken — WYSIWYG, "what you see is what you get": everything the
 *    user sees resolves against SceneIndex, molvis' record of what is actually
 *    drawn (`.claude/notes/canvas-sceneindex.md`).
 * 2. **Then coverage.** {@link snapshotCoversAnalysis} is the single
 *    declaration of what an analysis job snapshot can express; the panel does
 *    not restate the rule, and it carries no per-id exceptions — an analysis
 *    with a bespoke panel of its own (RDF, the radial distribution function;
 *    MSD, mean squared displacement) routes exactly like any other entry.
 * 3. **Otherwise main thread.** Today that is the velocity-driven `series`
 *    shapes — VACF (velocity autocorrelation function), Einstein diffusion,
 *    power spectrum — because a snapshot carries no `vx` / `vy` / `vz` velocity
 *    columns to stack, plus `frameGroupSets`, which needs a per-observable
 *    atom-group editor: UI state no snapshot can carry.
 *
 * @param definition the catalog entry about to be run
 * @returns the route that entry takes
 * @example
 * ```ts
 * // `entry` is any catalog entry — `getAnalysisDefinition(id)` in stage.
 * // Positions alone answer this one, so the worker may have it.
 * planAnalysisRun({ ...entry, inputKind: "frame", requires: [] });
 * // → { route: "worker" }
 *
 * // Except center of mass: the canvas has to stay the one truth for it.
 * planAnalysisRun({ ...entry, id: COM_ANALYSIS_ID, inputKind: "frame" });
 * // → { route: "pipeline" }
 * ```
 */
export function planAnalysisRun(
  definition: AnalysisDefinition,
): AnalysisRunPlan {
  if (isComAnalysisId(definition.id) || isRgAnalysisId(definition.id)) {
    return { route: "pipeline" };
  }
  if (snapshotCoversAnalysis(definition)) return { route: "worker" };
  return { route: "main" };
}
