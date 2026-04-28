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
    if (!bonds || bonds.nrows() === 0) return false;
    // Bond rendering needs the canonical atom-index columns. A bonds
    // block parsed from LAMMPS `dump local` (or any other source that
    // doesn't follow molvis's `atomi`/`atomj` convention) won't render
    // without a column-rename step — auto-attaching here would crash
    // inside `buildBondBuffers`'s `viewColU32("atomi")`.
    return (
      bonds.dtype("atomi") !== undefined && bonds.dtype("atomj") !== undefined
    );
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

  async apply(input: Frame, ctx: PipelineContext): Promise<Frame> {
    const artist = ctx.app.artist;
    if (ctx.changeKind === "position") {
      artist.refreshBondPositions(input);
    } else {
      // Awaited for the same reason as DrawAtomModifier — bond shader
      // compile must finish before applySceneIndexToMeshes uploads.
      await artist.drawBonds(
        input,
        this._radius !== undefined ? { radii: this._radius } : undefined,
      );
    }
    return input;
  }

  applyVisibility(app: import("../app").MolvisApp, visible: boolean): void {
    app.artist.bondMesh.setEnabled(visible);
  }
}
