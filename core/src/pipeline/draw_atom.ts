import type { Frame } from "@molcrafts/molrs";
import { BaseModifier, ModifierCapability } from "./modifier";
import type { PipelineContext } from "./types";

/**
 * Auto-attaches when the frame carries any atoms.
 *
 * `radiusScale` multiplies the per-element style radius — useful for
 * highlighting a layer (>1) or showing a denser bond skeleton (<1)
 * without changing the global representation.
 */
export class DrawAtomModifier extends BaseModifier {
  static readonly NAME = "Draw Atoms";
  private _radiusScale = 1.0;

  constructor(id = "draw-atom") {
    super(id, DrawAtomModifier.NAME, new Set([ModifierCapability.Draws]));
  }

  matches(frame: Frame): boolean {
    const atoms = frame.getBlock("atoms");
    return atoms !== undefined && atoms.nrows() > 0;
  }

  get radiusScale(): number {
    return this._radiusScale;
  }
  set radiusScale(value: number) {
    if (this._radiusScale === value) return;
    this._radiusScale = value;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:rs=${this._radiusScale}`;
  }

  async apply(input: Frame, ctx: PipelineContext): Promise<Frame> {
    const artist = ctx.app.artist;
    if (ctx.changeKind === "position") {
      artist.refreshAtomPositions(input);
    } else {
      // Awaited — drawAtoms internally awaits shader compile before
      // registering atom buffers. Without the await here the
      // pipeline's downstream `applySceneIndexToMeshes()` would see a
      // null atom state and disable the mesh.
      await artist.drawAtoms(input, { radiusScale: this._radiusScale });
    }
    return input;
  }

  applyVisibility(app: import("../app").MolvisApp, visible: boolean): void {
    app.artist.atomMesh.setEnabled(visible);
  }
}
