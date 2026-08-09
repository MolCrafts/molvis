/**
 * Ensure Cluster + COM / Rg pipeline steps exist (Analysis / Add happy path).
 */

import type { MolvisApp } from "../app";
import { CenterOfMassModifier } from "../modifiers/CenterOfMassModifier";
import { ClusterModifier } from "../modifiers/ClusterModifier";
import { RadiusOfGyrationModifier } from "../modifiers/RadiusOfGyrationModifier";
import { nextModifierId } from "./modifier_registry";

export function findClusterModifiers(app: MolvisApp): ClusterModifier[] {
  return app.modifierPipeline
    .modifiers()
    .filter((m): m is ClusterModifier => m instanceof ClusterModifier);
}

export function findClusterModifier(
  app: MolvisApp,
): ClusterModifier | undefined {
  const all = findClusterModifiers(app);
  return all.length > 0 ? all[all.length - 1] : undefined;
}

export function findCenterOfMassModifier(
  app: MolvisApp,
): CenterOfMassModifier | undefined {
  return app.modifierPipeline
    .modifiers()
    .find((m): m is CenterOfMassModifier => m instanceof CenterOfMassModifier);
}

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

/** Catalog analysis ids that paint COM / Rg via pipeline. */
export const COM_ANALYSIS_ID = "shape.center_of_mass";
/** Catalog id for RadiusOfGyration binding (label: Radius of gyration). */
export const RG_ANALYSIS_ID = "shape.cluster_properties";

export function isComAnalysisId(id: string): boolean {
  return id === COM_ANALYSIS_ID;
}

export function isRgAnalysisId(id: string): boolean {
  return id === RG_ANALYSIS_ID;
}
