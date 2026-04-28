import type { Frame } from "@molcrafts/molrs";
import { BaseModifier, ModifierCapability } from "./modifier";
import type { PipelineContext } from "./types";

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

  constructor(id = "draw-box") {
    super(id, DrawBoxModifier.NAME, new Set([ModifierCapability.Draws]));
  }

  matches(frame: Frame): boolean {
    return frame.simbox !== undefined;
  }

  get thicknessScale(): number {
    return this._thicknessScale;
  }
  set thicknessScale(value: number) {
    if (this._thicknessScale === value) return;
    this._thicknessScale = value;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:t=${this._thicknessScale}`;
  }

  apply(input: Frame, ctx: PipelineContext): Frame {
    // Box geometry can change between frames (NPT trajectories), so
    // we redraw on every change kind including "position".
    // `drawBox(undefined)` collapses to a clear, so the no-box branch
    // doesn't need a separate code path.
    ctx.app.artist.drawBox(input.simbox, {
      thicknessScale: this._thicknessScale,
    });
    return input;
  }

  applyVisibility(app: import("../app").MolvisApp, visible: boolean): void {
    const boxMesh = app.world.scene.getMeshByName("sim_box");
    if (boxMesh) boxMesh.setEnabled(visible);
  }
}
