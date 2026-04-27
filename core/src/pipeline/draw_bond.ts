import type { Frame } from "@molcrafts/molrs";
import { BaseModifier, ModifierCapability } from "./modifier";
import type { PipelineContext } from "./types";

/**
 * Auto-attaches when the frame carries any bonds.
 *
 * `radius === undefined` means "follow `StyleManager`'s representation
 * default", so global style switches still propagate. Setting a number
 * pins the radius for this layer only — the override stays even when
 * the user toggles representations.
 */
export class DrawBondModifier extends BaseModifier {
  static readonly NAME = "Draw Bonds";
  private _radius: number | undefined = undefined;

  constructor(id = "draw-bond") {
    super(id, DrawBondModifier.NAME, new Set([ModifierCapability.Draws]));
  }

  matches(frame: Frame): boolean {
    const bonds = frame.getBlock("bonds");
    return bonds !== undefined && bonds.nrows() > 0;
  }

  get radius(): number | undefined {
    return this._radius;
  }
  set radius(value: number | undefined) {
    if (this._radius === value) return;
    this._radius = value;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:r=${this._radius ?? "auto"}`;
  }

  apply(input: Frame, ctx: PipelineContext): Frame {
    const artist = ctx.app.artist;
    if (ctx.changeKind === "position") {
      artist.refreshBondPositions(input);
    } else {
      void artist.drawBonds(
        input,
        this._radius !== undefined ? { radii: this._radius } : undefined,
      );
    }
    return input;
  }
}
