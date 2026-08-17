/**
 * OVITO-style **Generate trajectory lines**: polyline paths of atoms
 * across the loaded trajectory.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import { buildTrajectoryLines } from "../algo/trajectory_lines";
import { viewAtomCoords } from "../io/atom_coords";
import { LineSystemOverlay } from "../overlays/line_system";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { logger } from "../utils/logger";

export class TrajectoryLinesModifier extends BaseModifier {
  static readonly NAME = "Generate trajectory lines";

  private _onlySelection = true;
  private _maxAtoms = 200;
  private _frameStride = 1;
  private _color = "#ffaa44";
  private _opacity = 0.9;
  private _overlayId: string | null = null;

  constructor(id = "trajectory-lines-default") {
    super(
      id,
      TrajectoryLinesModifier.NAME,
      new Set([ModifierCapability.Draws]),
    );
  }

  get onlySelection(): boolean {
    return this._onlySelection;
  }
  get maxAtoms(): number {
    return this._maxAtoms;
  }
  get frameStride(): number {
    return this._frameStride;
  }
  get color(): string {
    return this._color;
  }
  get opacity(): number {
    return this._opacity;
  }

  setOnlySelection(v: boolean): void {
    this._onlySelection = v;
  }
  setMaxAtoms(v: number): void {
    this._maxAtoms = Math.max(1, Math.floor(v));
  }
  setFrameStride(v: number): void {
    this._frameStride = Math.max(1, Math.floor(v));
  }
  setColor(v: string): void {
    this._color = v;
  }
  setOpacity(v: number): void {
    this._opacity = Math.max(0, Math.min(1, v));
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._onlySelection}:${this._maxAtoms}:${this._frameStride}:${this._color}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    if (!this.enabled) return input;

    const traj = context.app?.system?.trajectory;
    if (!traj || typeof traj.length !== "number" || traj.length < 2) {
      logger.warn("Generate trajectory lines: need trajectory with ≥2 frames");
      return input;
    }

    const atoms = input.getBlock("atoms");
    if (!atoms) return input;
    const n = atoms.nrows();

    let atomIndices: number[];
    if (this._onlySelection) {
      atomIndices = context.currentSelection.getIndices().filter((i) => i < n);
      if (atomIndices.length === 0) {
        // Fall back to first maxAtoms atoms if nothing selected
        atomIndices = Array.from(
          { length: Math.min(n, this._maxAtoms) },
          (_, i) => i,
        );
      }
    } else {
      atomIndices = Array.from({ length: n }, (_, i) => i);
    }
    if (atomIndices.length > this._maxAtoms) {
      atomIndices = atomIndices.slice(0, this._maxAtoms);
    }

    const frames: Array<{
      x: ArrayLike<number>;
      y: ArrayLike<number>;
      z: ArrayLike<number>;
    }> = [];
    const len = traj.length;
    for (let f = 0; f < len; f++) {
      let fr: Frame | null = null;
      try {
        fr = traj.get(f) ?? null;
      } catch {
        fr = null;
      }
      if (!fr) continue;
      const atomsBlock = fr.getBlock("atoms");
      if (!atomsBlock) continue;
      const coords = viewAtomCoords(atomsBlock);
      if (!coords?.x || !coords.y || !coords.z) continue;
      frames.push({ x: coords.x, y: coords.y, z: coords.z });
    }

    const trajLines = buildTrajectoryLines(
      frames,
      atomIndices,
      this._frameStride,
    );
    const lines = trajLines.map((tl) => {
      const poly: Array<{ x: number; y: number; z: number }> = [];
      for (let i = 0; i < tl.path.length; i += 3) {
        poly.push({ x: tl.path[i], y: tl.path[i + 1], z: tl.path[i + 2] });
      }
      return poly;
    });

    const app = context.app;
    const overlayId = this._overlayId;
    const color = this._color;
    const opacity = this._opacity;

    context.postRenderEffects.push(() => {
      if (overlayId && app.overlayManager.get(overlayId)) {
        const existing = app.overlayManager.get(overlayId) as LineSystemOverlay;
        existing.update({ lines, color, opacity, name: "TrajectoryLines" });
        app.events.emit("overlay-changed", { overlay: existing });
      } else {
        const overlay = LineSystemOverlay.create(app.scene, {
          lines,
          color,
          opacity,
          name: "TrajectoryLines",
        });
        this._overlayId = overlay.id;
        app.overlayManager.add(overlay);
        app.events.emit("overlay-added", { overlay });
      }
    });

    return input;
  }

  cleanup(app: { overlayManager: { remove(id: string): void } }): void {
    if (this._overlayId) {
      app.overlayManager.remove(this._overlayId);
      this._overlayId = null;
    }
  }

  applyVisibility(app: import("../app").MolvisApp, visible: boolean): void {
    if (!this._overlayId) return;
    const o = app.overlayManager.get(this._overlayId);
    if (o) o.visible = visible;
  }
}
