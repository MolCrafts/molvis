import type { EffectsSettings } from "../settings";
import { MATERIAL_PRESETS, type MaterialStyle } from "./material";
import {
  type BondColorMode,
  findRepresentation,
  type RepresentationId,
  type RepresentationStyle,
} from "./representation";

export type VisualPresetId = RepresentationId | "flat";
export type OutlineStyle = Pick<
  EffectsSettings,
  "outlineEnabled" | "atomOutline" | "bondOutline"
>;
export interface VisualPreset {
  readonly id: VisualPresetId;
  readonly name: string;
  readonly representation: RepresentationStyle;
  readonly atomMaterial: MaterialStyle;
  readonly bondMaterial: MaterialStyle;
  readonly bondColorMode: BondColorMode;
  readonly outline: OutlineStyle;
}

/** The only catalog of complete looks; geometry and material catalogs stay independent. */
type PresetEntry = [
  VisualPresetId,
  RepresentationId,
  keyof typeof MATERIAL_PRESETS,
  number,
  number,
  boolean,
  BondColorMode,
];
export const VISUAL_PRESETS: readonly VisualPreset[] = Object.freeze(
  (
    [
      ["ball-and-stick", "ball-and-stick", "matte", 0, 0, false, "split"],
      ["flat", "ball-and-stick", "unlit", 0.12, 0.2, true, "split"],
      [
        "ball-and-tube",
        "ball-and-tube",
        "illustrative",
        0.045,
        0.1,
        true,
        "split",
      ],
      ["tube", "tube", "illustrative", 0, 0.1, true, "split"],
      ["metal-tube", "metal-tube", "illustrative", 0.06, 0.1, true, "split"],
      ["wireframe", "wireframe", "illustrative", 0, 0, true, "split"],
      ["bubble", "bubble", "illustrative", 0.035, 0, false, "split"],
      ["spacefill", "spacefill", "illustrative", 0.02, 0, false, "split"],
      ["skeletal", "skeletal", "unlit", 0, 0.8, true, "theme"],
      ["graph", "graph", "unlit", 0.14, 0.35, true, "theme"],
    ] satisfies PresetEntry[]
  ).map(
    ([
      id,
      geometry,
      material,
      atomOutline,
      bondOutline,
      outlineEnabled,
      bondColorMode,
    ]) => {
      const representation = findRepresentation(geometry);
      const surface = MATERIAL_PRESETS[material];
      return Object.freeze({
        id,
        name: id === "flat" ? "Flat" : representation.name,
        representation,
        atomMaterial: surface,
        bondMaterial: surface,
        bondColorMode,
        outline: Object.freeze({ atomOutline, bondOutline, outlineEnabled }),
      });
    },
  ),
);

export function findVisualPreset(id: VisualPresetId): VisualPreset {
  const preset = VISUAL_PRESETS.find((value) => value.id === id);
  if (!preset) throw new Error(`Unknown visual preset: ${id}`);
  return preset;
}
