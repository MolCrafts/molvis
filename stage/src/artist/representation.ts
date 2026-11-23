/**
 * Molecular geometry policies. Surface response, coloring and effects are
 * configured independently; complete looks live in visual_preset.ts.
 */

export type RepresentationId =
  | "ball-and-stick"
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
export type BondColorMode = "theme" | "split";
export type BondOrderMode = "multiple" | "single";
export type RepresentationLabelMode = "none" | "skeletal";

export const REPRESENTATION_IDS = [
  "ball-and-stick",
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

  readonly bondRadiusScale: number;
  readonly showBonds: boolean;
  readonly bondOrderMode: BondOrderMode;

  readonly labels: RepresentationLabelMode;
  readonly hideCarbonHydrogens: boolean;
}

export const BALL_AND_STICK: RepresentationStyle = {
  id: "ball-and-stick",
  name: "Ball and Stick",
  atomRadiusMode: "theme",
  atomRadiusScale: 0.5,
  uniformAtomRadius: 0.32,
  atomVisibility: "all",
  bondRadiusScale: 0.7,
  showBonds: true,
  bondOrderMode: "multiple",
  labels: "none",
  hideCarbonHydrogens: false,
};

export const BALL_AND_TUBE: RepresentationStyle = {
  ...BALL_AND_STICK,
  id: "ball-and-tube",
  name: "Ball and Tube",
  atomRadiusScale: 0.55,
  bondRadiusScale: 1.8,
  bondOrderMode: "single",
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
};

export const METAL_TUBE: RepresentationStyle = {
  ...TUBE,
  id: "metal-tube",
  name: "Metal Tube",
  atomVisibility: "metal-tube-joints",
  atomRadiusScale: 0.9,
};

export const WIREFRAME: RepresentationStyle = {
  ...TUBE,
  id: "wireframe",
  name: "Wireframe",
  bondRadiusScale: 0.5,
};

export const BUBBLE: RepresentationStyle = {
  ...BALL_AND_STICK,
  id: "bubble",
  name: "Bubble",
  atomRadiusScale: 1.35,
  showBonds: false,
  bondRadiusScale: 0,
};

export const SPACEFILL: RepresentationStyle = {
  ...BUBBLE,
  id: "spacefill",
  name: "Spacefill",
  atomRadiusMode: "vdw",
  atomRadiusScale: 1,
};

export const SKELETAL: RepresentationStyle = {
  ...BALL_AND_STICK,
  id: "skeletal",
  name: "Skeletal",
  atomVisibility: "none",
  atomRadiusScale: 0.35,
  bondRadiusScale: 0.3,
  bondOrderMode: "multiple",
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
  bondRadiusScale: 0.45,
  bondOrderMode: "single",
};

export const REPRESENTATIONS: readonly RepresentationStyle[] = Object.freeze(
  [
    BALL_AND_STICK,
    BALL_AND_TUBE,
    TUBE,
    METAL_TUBE,
    WIREFRAME,
    BUBBLE,
    SPACEFILL,
    SKELETAL,
    GRAPH,
  ].map((value) => Object.freeze(value)),
);

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

/** Validates portable geometry values independently of materials and presets. */
export class Representation implements RepresentationStyle {
  declare readonly id: RepresentationId;
  declare readonly name: string;
  declare readonly atomRadiusMode: RadiusMode;
  declare readonly atomRadiusScale: number;
  declare readonly uniformAtomRadius: number;
  declare readonly atomVisibility: AtomVisibility;
  declare readonly bondRadiusScale: number;
  declare readonly showBonds: boolean;
  declare readonly bondOrderMode: BondOrderMode;
  declare readonly labels: RepresentationLabelMode;
  declare readonly hideCarbonHydrogens: boolean;

  constructor(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Representation must be an object");
    const value = input as Record<string, unknown>;
    for (const key of Object.keys(value))
      if (!Object.hasOwn(BALL_AND_STICK, key))
        throw new Error(`Unknown representation parameter '${key}'`);
    if (
      !REPRESENTATION_IDS.includes(value.id as RepresentationId) ||
      typeof value.name !== "string"
    )
      throw new Error("Invalid representation id/name");
    for (const key of [
      "atomRadiusScale",
      "uniformAtomRadius",
      "bondRadiusScale",
    ] as const)
      if (
        typeof value[key] !== "number" ||
        !Number.isFinite(value[key]) ||
        value[key] < 0
      )
        throw new Error(`Invalid representation ${key}`);
    for (const key of ["showBonds", "hideCarbonHydrogens"] as const)
      if (typeof value[key] !== "boolean")
        throw new Error(`Invalid representation ${key}`);
    for (const [key, choices] of [
      ["atomRadiusMode", ["theme", "vdw", "uniform"]],
      [
        "atomVisibility",
        ["all", "metals", "tube-joints", "metal-tube-joints", "none"],
      ],
      ["bondOrderMode", ["multiple", "single"]],
      ["labels", ["none", "skeletal"]],
    ] as const) {
      if (!(choices as readonly unknown[]).includes(value[key]))
        throw new Error(`Invalid representation ${key}`);
    }
    Object.assign(this, value);
    Object.freeze(this);
  }
}
