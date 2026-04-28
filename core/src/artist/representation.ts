/**
 * Molecular representation presets.
 *
 * A representation controls how atoms and bonds are rendered by
 * setting radius scales and visibility flags. Ribbon visibility is
 * not a representation concern — it lives entirely under
 * `DrawRibbonModifier`'s attach state.
 */

export interface RepresentationStyle {
  readonly name: string;
  readonly atomRadiusScale: number;
  readonly bondRadiusScale: number;
  readonly showAtoms: boolean;
  readonly showBonds: boolean;
}

export const BALL_AND_STICK: RepresentationStyle = {
  name: "Ball and Stick",
  atomRadiusScale: 0.6,
  bondRadiusScale: 0.6,
  showAtoms: true,
  showBonds: true,
} as const;

export const SPACEFILL: RepresentationStyle = {
  name: "Spacefill",
  atomRadiusScale: 1.0,
  bondRadiusScale: 0.0,
  showAtoms: true,
  showBonds: false,
} as const;

export const STICK: RepresentationStyle = {
  name: "Stick",
  atomRadiusScale: 0.25,
  bondRadiusScale: 0.8,
  showAtoms: true,
  showBonds: true,
} as const;

export const REPRESENTATIONS: readonly RepresentationStyle[] = [
  BALL_AND_STICK,
  SPACEFILL,
  STICK,
] as const;

export function findRepresentation(
  name: string,
): RepresentationStyle | undefined {
  return REPRESENTATIONS.find((r) => r.name === name);
}
