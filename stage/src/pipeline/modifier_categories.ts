/**
 * Add-menu groups — **same folders as OVITO** (minus Python).
 *
 * | Group | Who belongs |
 * |-------|-------------|
 * | Selection | produce / act on a selection set |
 * | Modification | topology / coordinate / filter / property edits |
 * | Coloring | per-atom color writers |
 * | Structure identification | local structure / order → columns (molrs) |
 * | Visualization | bonds, cell, surfaces, polyhedra, trajectory lines, … |
 * | Analysis | pipeline property compute that feeds viz (e.g. displacements) |
 *
 * Chart-only analyses (RDF, MSD, histograms, …) stay in the **left Analysis
 * panel**, not here — they do not change the scene by themselves.
 */
export const MODIFIER_CATEGORIES = [
  "Selection",
  "Modification",
  "Coloring",
  "Structure identification",
  "Visualization",
  "Analysis",
] as const;

export type ModifierCategory = (typeof MODIFIER_CATEGORIES)[number];
