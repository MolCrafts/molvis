import { Frame } from "@molcrafts/molvis-core/molrs";
import { hexToLinearRgb } from "../artist/palette";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../color_override_keys";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";

/**
 * Modifier that assigns a uniform color to the current pipeline selection.
 * Reads selection from context.currentSelection (set by a preceding SelectModifier).
 * Injects the color-override columns from `../color_override_keys`.
 */
export class AssignColorModifier extends BaseModifier {
  private _color = "#FF4444";
  private _lastCount = 0;

  constructor(id = "assign-color-default") {
    super(
      id,
      "Assign Color",
      new Set([
        ModifierCapability.ConsumesSelection,
        ModifierCapability.TransformsData,
      ]),
    );
  }

  get selectedCount(): number {
    return this._lastCount;
  }

  get primaryColor(): string {
    return this._color;
  }

  /**
   * Update the color used for the selection.
   */
  setPrimaryColor(color: string): void {
    this._color = color;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._color}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const selection = context.currentSelection;
    const indices = selection.getIndices();
    if (indices.length === 0) return input;

    this._lastCount = indices.length;

    if (!input.has("atoms")) return input;
    const atoms = input.get("atoms");

    const atomCount = atoms.nRows;
    if (atomCount === 0) return input;

    // Start from existing overrides or default (NaN = no override)
    const existingR = atoms.has(COLOR_OVERRIDE_R)
      ? (atoms.view(COLOR_OVERRIDE_R) as Float64Array)
      : undefined;
    const existingG = atoms.has(COLOR_OVERRIDE_G)
      ? (atoms.view(COLOR_OVERRIDE_G) as Float64Array)
      : undefined;
    const existingB = atoms.has(COLOR_OVERRIDE_B)
      ? (atoms.view(COLOR_OVERRIDE_B) as Float64Array)
      : undefined;

    const colorR = existingR
      ? new Float64Array(existingR)
      : new Float64Array(atomCount).fill(Number.NaN);
    const colorG = existingG
      ? new Float64Array(existingG)
      : new Float64Array(atomCount).fill(Number.NaN);
    const colorB = existingB
      ? new Float64Array(existingB)
      : new Float64Array(atomCount).fill(Number.NaN);

    let hasOverride = existingR !== undefined;

    // Apply color to selected indices
    const [r, g, b] = hexToLinearRgb(this._color);
    for (const idx of indices) {
      if (idx < atomCount) {
        colorR[idx] = r;
        colorG[idx] = g;
        colorB[idx] = b;
        hasOverride = true;
      }
    }

    if (!hasOverride) return input;

    // Create new Frame with color override columns
    const result = new Frame();
    result.set("atoms", atoms);
    if (!result.has("atoms")) return input;
    const resultAtoms = result.get("atoms");

    resultAtoms.set(COLOR_OVERRIDE_R, colorR);
    resultAtoms.set(COLOR_OVERRIDE_G, colorG);
    resultAtoms.set(COLOR_OVERRIDE_B, colorB);

    // Copy bonds block if present
    const bonds = input.has("bonds") ? input.get("bonds") : undefined;
    if (bonds) result.set("bonds", bonds);

    // Preserve box
    const box = input.box;
    if (box) result.box = box;

    return result;
  }
}
