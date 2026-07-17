import { Box, type Frame } from "@molcrafts/molrs";
import { BaseModifier, ModifierCapability } from "./modifier";
import type { PipelineContext } from "./types";

export interface DrawBoxSpec {
  lengths: [number, number, number];
  origin: [number, number, number];
  pbc: [boolean, boolean, boolean];
}

/**
 * Auto-attaches when the frame carries a simulation box.
 *
 * `thicknessScale` rides on top of the camera-distance-aware edge
 * width — small/large values keep the wireframe legible at zoom
 * extremes that the auto-thickness alone can't cover.
 */
export class DrawBoxModifier extends BaseModifier {
  static readonly NAME = "Draw Box";
  private _thicknessScale = 1.0;
  private _manualBox: DrawBoxSpec | null = null;

  constructor(id = "draw-box", manualBox?: DrawBoxSpec | null) {
    super(id, DrawBoxModifier.NAME, new Set([ModifierCapability.Draws]));
    this.manualBox = manualBox ?? null;
  }

  matches(frame: Frame): boolean {
    return this._manualBox !== null || frame.simbox !== undefined;
  }

  get thicknessScale(): number {
    return this._thicknessScale;
  }
  set thicknessScale(value: number) {
    if (this._thicknessScale === value) return;
    this._thicknessScale = value;
  }

  get manualBox(): DrawBoxSpec | null {
    return this._manualBox
      ? {
          lengths: [...this._manualBox.lengths],
          origin: [...this._manualBox.origin],
          pbc: [...this._manualBox.pbc],
        }
      : null;
  }

  set manualBox(value: DrawBoxSpec | null) {
    this._manualBox = value
      ? {
          lengths: [...value.lengths],
          origin: [...value.origin],
          pbc: [...value.pbc],
        }
      : null;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:t=${this._thicknessScale}:box=${JSON.stringify(this._manualBox)}`;
  }

  apply(input: Frame, ctx: PipelineContext): Frame {
    // Box geometry can change between frames (NPT trajectories), so
    // we redraw on every change kind including "position".
    // `drawBox(undefined)` collapses to a clear, so the no-box branch
    // doesn't need a separate code path.
    if (!ctx.app.styleManager.getShowBox()) {
      ctx.app.artist.drawBox(undefined);
      return input;
    }
    const box = this.createManualBox() ?? input.simbox;
    try {
      ctx.app.artist.drawBox(box, {
        thicknessScale: this._thicknessScale,
      });
    } finally {
      box?.free();
    }
    return input;
  }

  applyVisibility(app: import("../app").MolvisApp, visible: boolean): void {
    const boxMesh = app.world.scene.getMeshByName("sim_box");
    if (boxMesh) boxMesh.setEnabled(visible);
  }

  private createManualBox(): Box | undefined {
    if (!this._manualBox) return undefined;
    const { lengths, origin, pbc } = this._manualBox;
    return Box.ortho(
      Float64Array.from(lengths),
      Float64Array.from(origin),
      pbc[0],
      pbc[1],
      pbc[2],
    );
  }
}
