import { Frame } from "@molcrafts/molrs";
import { hexToLinearRgb } from "../artist/palette";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "./ColorByPropertyModifier";

/**
 * Modifier that assigns a uniform color to the current pipeline selection.
 * Reads selection from context.currentSelection (set by a preceding SelectModifier).
 * Injects __color_r/g/b override columns (same as ColorByPropertyModifier).
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

    const atoms = input.getBlock("atoms");
    if (!atoms) return input;

    const atomCount = atoms.nrows();
    if (atomCount === 0) return input;

    // Start from existing overrides or default (NaN = no override)
    const existingR = atoms.dtype(COLOR_OVERRIDE_R)
      ? atoms.viewColF(COLOR_OVERRIDE_R)
      : undefined;
    const existingG = atoms.dtype(COLOR_OVERRIDE_G)
      ? atoms.viewColF(COLOR_OVERRIDE_G)
      : undefined;
    const existingB = atoms.dtype(COLOR_OVERRIDE_B)
      ? atoms.viewColF(COLOR_OVERRIDE_B)
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
    result.insertBlock("atoms", atoms);
    const resultAtoms = result.getBlock("atoms");
    if (!resultAtoms) return input;

    resultAtoms.setColF(COLOR_OVERRIDE_R, colorR);
    resultAtoms.setColF(COLOR_OVERRIDE_G, colorG);
    resultAtoms.setColF(COLOR_OVERRIDE_B, colorB);

    // Copy bonds block if present
    const bonds = input.getBlock("bonds");
    if (bonds) result.insertBlock("bonds", bonds);

    // Preserve box
    const box = input.simbox;
    if (box) result.simbox = box;

    return result;
  }
}
