import {
  buildSourceColorLegend,
  DataSourceModifier,
  type Modifier,
} from "@molvis/core";

/** A data source the synthesis step may include. */
export interface BranchOption {
  id: string;
  name: string;
}

/**
 * Select the enabled data sources from a pipeline's modifier list. Filters to
 * enabled {@link DataSourceModifier} instances and maps each to `{ id, name }`
 * — the rows the scene-synthesis panel's source checklist renders. Disabled
 * sources and non-data-source modifiers are excluded.
 */
export function selectEnabledDataSources(
  modifiers: readonly Modifier[],
): BranchOption[] {
  return modifiers
    .filter((m): m is DataSourceModifier =>
      m instanceof DataSourceModifier ? m.enabled : false,
    )
    .map((m) => ({ id: m.id, name: m.name }));
}

/**
 * Format an RMSD-to-reference value for a status line: 3 decimals + Å, or an
 * em dash for null / non-finite (reference source, or not-yet-computed).
 */
export function formatRmsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(3)} Å`;
}

/** A source→color legend row: source id label + its palette hex. */
export interface LegendEntry {
  label: string;
  color: string;
}

/**
 * Map source ids (in order) to their per-source legend color. The i-th source
 * gets the categorical color for ordinal i — curated palette entries first,
 * then the core golden-angle extension for larger source counts. This is the
 * same mapping the color-by-source mode (`ColorByPropertyModifier` categorical
 * on `source_id`) uses, so the legend matches the canvas.
 */
export function buildSourceLegend(sourceIds: readonly string[]): LegendEntry[] {
  // Look up by ordinal id, not array position: buildSourceColorLegend dedups
  // and re-sorts its rows, so positional indexing would couple to an unstated
  // invariant of that function.
  const byOrdinal = new Map(
    buildSourceColorLegend(sourceIds.map((_, i) => i)).map((e) => [
      e.sourceId,
      e.hex,
    ]),
  );
  return sourceIds.map((id, i) => ({
    label: id,
    color: byOrdinal.get(i) ?? "#000000",
  }));
}
