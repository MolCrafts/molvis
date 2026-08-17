/**
 * Structure-formula label colors (text only — never filled balls).
 * Matches common ChemDraw / ACS 2D conventions for heteroatoms.
 *
 * These are **scientific domain colors**, not product UI tokens. UI chrome /
 * selection / paper come from `--msk-*` ({@link SKETCH_TOKEN_DEFAULTS}).
 */
export const SKETCH_ELEMENT_COLORS: Readonly<Record<string, string>> = {
  H: "#111111",
  B: "#b36b00",
  C: "#111111",
  N: "#0000ee",
  O: "#ee0000",
  F: "#008000",
  P: "#ff8000",
  S: "#c0a000",
  Cl: "#008000",
  Br: "#a52a2a",
  I: "#660099",
  Si: "#8a6d3b",
};

/** Carbon and unlabeled vertices stay pure black. */
const DEFAULT_LABEL = "#111111";

/** Resolve label color for an element symbol. */
export function colorForElement(symbol: string): string {
  return SKETCH_ELEMENT_COLORS[symbol] ?? DEFAULT_LABEL;
}

/**
 * Whether this element is drawn as a symbol in 2D structure style.
 * Carbon is skeleton-only (bonds meet at a vertex) unless charged / selected.
 */
export function isLabeledElement(
  symbol: string,
  opts: { omitCarbonLabel: boolean; charge?: number; forceLabel?: boolean },
): boolean {
  if (opts.forceLabel) return true;
  if (opts.charge !== undefined && opts.charge !== 0) return true;
  if (symbol === "C" && opts.omitCarbonLabel) return false;
  return true;
}
