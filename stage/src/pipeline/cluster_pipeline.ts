/**
 * Installers for the cluster analysis steps of the modifier pipeline.
 *
 * The pipeline is an ordered list of modifiers, each transforming the frame it
 * hands to the next. Painting cluster results on the canvas needs a Cluster
 * step — which groups atoms into clusters — upstream of a draw step: either
 * center of mass (COM, the mass-weighted average position of a cluster) or
 * radius of gyration (Rg, how far a cluster's atoms sit from that center on
 * average). Both product entry points land here: the Analysis panel's run
 * button, which must not stack a duplicate step when pressed twice (the
 * `ensure*` functions), and the pipeline Add menu, which always creates a new
 * one (`createClusterModifier`).
 */

import { COM_ANALYSIS_ID, RG_ANALYSIS_ID } from "../analysis/analysis_ids";
import type { MolvisApp } from "../app";
import { CenterOfMassModifier } from "../modifiers/CenterOfMassModifier";
import { ClusterModifier } from "../modifiers/ClusterModifier";
import { RadiusOfGyrationModifier } from "../modifiers/RadiusOfGyrationModifier";
import { nextModifierId } from "./modifier_registry";

/** Every Cluster step currently in the app's pipeline, in pipeline order. */
export function findClusterModifiers(app: MolvisApp): ClusterModifier[] {
  return app.modifierPipeline
    .modifiers()
    .filter((m): m is ClusterModifier => m instanceof ClusterModifier);
}

/**
 * The Cluster step new draw steps bind to: the last one in the pipeline, or
 * `undefined` when there is none.
 */
export function findClusterModifier(
  app: MolvisApp,
): ClusterModifier | undefined {
  const all = findClusterModifiers(app);
  return all.length > 0 ? all[all.length - 1] : undefined;
}

/**
 * The pipeline's center-of-mass draw step — first match, which
 * {@link ensureCenterOfMassModifier} keeps unique — or `undefined` when absent.
 */
export function findCenterOfMassModifier(
  app: MolvisApp,
): CenterOfMassModifier | undefined {
  return app.modifierPipeline
    .modifiers()
    .find((m): m is CenterOfMassModifier => m instanceof CenterOfMassModifier);
}

/**
 * The pipeline's radius-of-gyration draw step — first match, which
 * {@link ensureRadiusOfGyrationModifier} keeps unique — or `undefined` when
 * absent.
 */
export function findRadiusOfGyrationModifier(
  app: MolvisApp,
): RadiusOfGyrationModifier | undefined {
  return app.modifierPipeline
    .modifiers()
    .find(
      (m): m is RadiusOfGyrationModifier =>
        m instanceof RadiusOfGyrationModifier,
    );
}

/** Next free 1-based cluster slot among existing Cluster modifiers. */
export function nextClusterSlot(app: MolvisApp): number {
  const used = new Set(findClusterModifiers(app).map((m) => m.slot));
  let s = 1;
  while (used.has(s)) s++;
  return s;
}

/**
 * Insert a Cluster step if none exist. Returns an existing one (latest)
 * without creating duplicates — Analysis “run” path is idempotent.
 * New Cluster from Add menu uses {@link createClusterModifier}.
 */
export function ensureClusterModifier(app: MolvisApp): ClusterModifier {
  const existing = findClusterModifier(app);
  if (existing) return existing;
  return createClusterModifier(app);
}

/** Always create a new Cluster with the next free slot. */
export function createClusterModifier(app: MolvisApp): ClusterModifier {
  const slot = nextClusterSlot(app);
  const mod = new ClusterModifier(nextModifierId("cluster"), slot);
  app.modifierPipeline.addModifier(mod);
  return mod;
}

/** Ensure Cluster upstream + Center of mass draw step. */
export function ensureCenterOfMassModifier(
  app: MolvisApp,
): CenterOfMassModifier {
  const cluster = ensureClusterModifier(app);
  const existing = findCenterOfMassModifier(app);
  if (existing) {
    if (!existing.maskColumn) existing.setMaskColumn(cluster.columnName);
    return existing;
  }
  const mod = new CenterOfMassModifier(nextModifierId("com"));
  mod.setMaskColumn(cluster.columnName);
  app.modifierPipeline.addModifier(mod);
  return mod;
}

/** Ensure Cluster upstream + Radius of gyration draw step. */
export function ensureRadiusOfGyrationModifier(
  app: MolvisApp,
): RadiusOfGyrationModifier {
  const cluster = ensureClusterModifier(app);
  const existing = findRadiusOfGyrationModifier(app);
  if (existing) {
    if (!existing.maskColumn) existing.setMaskColumn(cluster.columnName);
    return existing;
  }
  const mod = new RadiusOfGyrationModifier(nextModifierId("rg"));
  mod.setMaskColumn(cluster.columnName);
  app.modifierPipeline.addModifier(mod);
  return mod;
}

/**
 * The two catalog analysis ids this module paints into the pipeline: center of
 * mass and radius of gyration. A catalog id is the string molrs — the Rust
 * molecular core, compiled to WASM — uses to name an analysis.
 *
 * Both are **declared** in `../analysis/analysis_ids`, the import-free id
 * table, and only re-exported here under the same names so pipeline-side
 * callers have a single address for the ids and the predicates below. Change a
 * value there, never here; this is not a second declaration.
 */
export { COM_ANALYSIS_ID, RG_ANALYSIS_ID };

/**
 * True when `id` is {@link COM_ANALYSIS_ID}, the catalog's center-of-mass
 * analysis. A caller that sees `true` installs the draw step above and reads
 * the result off the pipeline instead of dispatching through `runAnalysis`.
 */
export function isComAnalysisId(id: string): boolean {
  return id === COM_ANALYSIS_ID;
}

/**
 * True when `id` is {@link RG_ANALYSIS_ID}, the catalog's per-cluster shape
 * analysis that molvis presents as Radius of gyration. Same cue as
 * {@link isComAnalysisId}: install the draw step, read the result off the
 * pipeline.
 */
export function isRgAnalysisId(id: string): boolean {
  return id === RG_ANALYSIS_ID;
}
