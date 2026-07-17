/**
 * Molecular representation presets.
 *
 * A representation is a complete rendering contract: geometry visibility,
 * radius source, shader profile, color routing, bond-order policy, and optional
 * element labels. Colors themselves always come from the active MolVis theme
 * or per-particle color overrides.
 */

export type RepresentationId =
  | "ball-and-stick"
  | "flat"
  | "ball-and-tube"
  | "tube"
  | "metal-tube"
  | "wireframe"
  | "bubble"
  | "spacefill"
  | "skeletal"
  | "graph";

export type RadiusMode = "theme" | "vdw" | "uniform";
export type AtomVisibility =
  | "all"
  | "metals"
  | "tube-joints"
  | "metal-tube-joints"
  | "none";
export type ShadingMode = "lit" | "illustrative" | "flat";
export type BondColorMode = "theme" | "split";
export type BondOrderMode = "multiple" | "single";
export type RepresentationLabelMode = "none" | "skeletal";

export const REPRESENTATION_IDS = [
  "ball-and-stick",
  "flat",
  "ball-and-tube",
  "tube",
  "metal-tube",
  "wireframe",
  "bubble",
  "spacefill",
  "skeletal",
  "graph",
] as const satisfies readonly RepresentationId[];

export interface RepresentationStyle {
  readonly id: RepresentationId;
  readonly name: string;

  readonly atomRadiusMode: RadiusMode;
  readonly atomRadiusScale: number;
  readonly uniformAtomRadius: number;
  readonly atomVisibility: AtomVisibility;
  readonly atomShading: ShadingMode;
  /** Fraction of the sphere radius added outside its silhouette. */
  readonly atomOutline: number;

  readonly bondRadiusScale: number;
  readonly showBonds: boolean;
  readonly bondShading: ShadingMode;
  readonly bondColorMode: BondColorMode;
  readonly bondOrderMode: BondOrderMode;
  /** Fraction of the cylinder radius added outside its silhouette. */
  readonly bondOutline: number;

  /** Whether the global UI exposes an outline toggle for this preset. */
  readonly outlineConfigurable: boolean;
  /** Current global outline state. */
  readonly outlineEnabled: boolean;

  readonly labels: RepresentationLabelMode;
  readonly hideCarbonHydrogens: boolean;
}

export const BALL_AND_STICK: RepresentationStyle = {
  id: "ball-and-stick",
  name: "Ball and Stick",
  atomRadiusMode: "theme",
  atomRadiusScale: 0.6,
  uniformAtomRadius: 0.32,
  atomVisibility: "all",
  atomShading: "lit",
  atomOutline: 0,
  bondRadiusScale: 0.6,
  showBonds: true,
  bondShading: "lit",
  bondColorMode: "split",
  bondOrderMode: "multiple",
  bondOutline: 0,
  outlineConfigurable: false,
  outlineEnabled: false,
  labels: "none",
  hideCarbonHydrogens: false,
};

export const FLAT: RepresentationStyle = {
  ...BALL_AND_STICK,
  id: "flat",
  name: "Flat",
  atomShading: "flat",
  atomOutline: 0.12,
  bondShading: "flat",
  bondOutline: 0.2,
  outlineConfigurable: true,
  outlineEnabled: true,
};

export const BALL_AND_TUBE: RepresentationStyle = {
  ...BALL_AND_STICK,
  id: "ball-and-tube",
  name: "Ball and Tube",
  atomRadiusScale: 0.55,
  atomShading: "illustrative",
  atomOutline: 0.045,
  bondRadiusScale: 1.8,
  bondShading: "illustrative",
  bondOrderMode: "single",
  bondOutline: 0.1,
  outlineEnabled: true,
};

export const TUBE: RepresentationStyle = {
  ...BALL_AND_TUBE,
  id: "tube",
  name: "Tube",
  // Neutral-sized endpoint joints close the bond cylinders; they are tube
  // topology, not element-sized atom glyphs.
  atomVisibility: "tube-joints",
  atomRadiusScale: 1,
  bondRadiusScale: 2.5,
  atomOutline: 0,
};

export const METAL_TUBE: RepresentationStyle = {
  ...TUBE,
  id: "metal-tube",
  name: "Metal Tube",
  atomVisibility: "metal-tube-joints",
  atomRadiusScale: 0.9,
  atomShading: "illustrative",
  atomOutline: 0.06,
};

export const WIREFRAME: RepresentationStyle = {
  ...TUBE,
  id: "wireframe",
  name: "Wireframe",
  bondRadiusScale: 0.5,
  bondOutline: 0,
};

export const BUBBLE: RepresentationStyle = {
  ...BALL_AND_STICK,
  id: "bubble",
  name: "Bubble",
  atomRadiusScale: 1.35,
  atomShading: "illustrative",
  atomOutline: 0.035,
  showBonds: false,
  bondRadiusScale: 0,
};

export const SPACEFILL: RepresentationStyle = {
  ...BUBBLE,
  id: "spacefill",
  name: "Spacefill",
  atomRadiusMode: "vdw",
  atomRadiusScale: 1,
  atomOutline: 0.02,
};

export const SKELETAL: RepresentationStyle = {
  ...BALL_AND_STICK,
  id: "skeletal",
  name: "Skeletal",
  atomVisibility: "none",
  atomRadiusScale: 0.35,
  atomShading: "flat",
  bondRadiusScale: 0.3,
  bondShading: "flat",
  bondColorMode: "theme",
  bondOrderMode: "multiple",
  bondOutline: 0.8,
  outlineConfigurable: true,
  outlineEnabled: true,
  labels: "skeletal",
  hideCarbonHydrogens: true,
};

export const GRAPH: RepresentationStyle = {
  ...BALL_AND_STICK,
  id: "graph",
  name: "Graph",
  atomRadiusMode: "uniform",
  uniformAtomRadius: 0.32,
  atomRadiusScale: 1,
  atomShading: "flat",
  atomOutline: 0.14,
  bondRadiusScale: 0.45,
  bondShading: "flat",
  bondColorMode: "theme",
  bondOrderMode: "single",
  bondOutline: 0.35,
  outlineConfigurable: true,
  outlineEnabled: true,
};

export const REPRESENTATIONS: readonly RepresentationStyle[] = [
  BALL_AND_STICK,
  FLAT,
  BALL_AND_TUBE,
  TUBE,
  METAL_TUBE,
  WIREFRAME,
  BUBBLE,
  SPACEFILL,
  SKELETAL,
  GRAPH,
];

const REPRESENTATION_BY_ID = new Map(
  REPRESENTATIONS.map((representation) => [representation.id, representation]),
);

export function findRepresentation(id: RepresentationId): RepresentationStyle {
  const representation = REPRESENTATION_BY_ID.get(id);
  if (!representation) {
    throw new Error(`Unknown representation: ${id}`);
  }
  return representation;
}
