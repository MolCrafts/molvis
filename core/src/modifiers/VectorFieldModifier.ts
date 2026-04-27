/**
 * VectorFieldModifier — pipeline modifier that reads vector columns from the
 * current frame and creates/updates a VectorFieldOverlay as a side-effect.
 *
 * This modifier is pass-through: it returns the frame unchanged and uses
 * context.postRenderEffects to manage the overlay lifecycle.
 *
 * Example usage:
 *   pipeline.addModifier(new VectorFieldModifier("forces", {
 *     vxCol: "fx", vyCol: "fy", vzCol: "fz",
 *     scale: 0.05,
 *     colorMode: "magnitude",
 *   }));
 */

import type { Frame } from "@molcrafts/molrs";
import { VectorFieldOverlay } from "../overlays/vector_field";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { DType } from "../utils/dtype";

export interface VectorFieldModifierConfig {
  /** Column name for X coordinates (default: "x"). */
  xCol?: string;
  /** Column name for Y coordinates (default: "y"). */
  yCol?: string;
  /** Column name for Z coordinates (default: "z"). */
  zCol?: string;
  /** Column name for vector X component. Required. */
  vxCol: string;
  /** Column name for vector Y component. Required. */
  vyCol: string;
  /** Column name for vector Z component. Required. */
  vzCol: string;
  /** Arrow scale. Default: 1. */
  scale?: number;
  /** Color mode. Default: "magnitude". */
  colorMode?: "uniform" | "magnitude" | "direction";
  /** Base color for "uniform" mode. Default: "#4488ff". */
  color?: string;
  /** Max arrows. Default: 5000. */
  maxArrows?: number;
  /** Shaft radius. Default: 0.03. */
  shaftRadius?: number;
}

export class VectorFieldModifier extends BaseModifier {
  private readonly _cfg: Required<VectorFieldModifierConfig>;
  private _overlayId: string | null = null;

  constructor(id: string, config: VectorFieldModifierConfig) {
    super(
      id,
      "Vector Field",
      new Set([
        ModifierCapability.ConsumesSelection,
        ModifierCapability.TransformsData,
      ]),
    );
    this._cfg = {
      xCol: config.xCol ?? "x",
      yCol: config.yCol ?? "y",
      zCol: config.zCol ?? "z",
      vxCol: config.vxCol,
      vyCol: config.vyCol,
      vzCol: config.vzCol,
      scale: config.scale ?? 1,
      colorMode: config.colorMode ?? "magnitude",
      color: config.color ?? "#4488ff",
      maxArrows: config.maxArrows ?? 5000,
      shaftRadius: config.shaftRadius ?? 0.03,
    };
  }

  getCacheKey(): string {
    const c = this._cfg;
    return `${super.getCacheKey()}:${c.vxCol}:${c.vyCol}:${c.vzCol}:${c.scale}:${c.colorMode}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    if (!this.enabled) return input;

    const atoms = input.getBlock("atoms");
    if (!atoms) return input;

    const {
      xCol,
      yCol,
      zCol,
      vxCol,
      vyCol,
      vzCol,
      scale,
      colorMode,
      color,
      maxArrows,
      shaftRadius,
    } = this._cfg;

    const x =
      atoms.dtype(xCol) === DType.F64 ? atoms.viewColF(xCol) : undefined;
    const y =
      atoms.dtype(yCol) === DType.F64 ? atoms.viewColF(yCol) : undefined;
    const z =
      atoms.dtype(zCol) === DType.F64 ? atoms.viewColF(zCol) : undefined;
    const vx =
      atoms.dtype(vxCol) === DType.F64 ? atoms.viewColF(vxCol) : undefined;
    const vy =
      atoms.dtype(vyCol) === DType.F64 ? atoms.viewColF(vyCol) : undefined;
    const vz =
      atoms.dtype(vzCol) === DType.F64 ? atoms.viewColF(vzCol) : undefined;

    if (!x || !y || !z || !vx || !vy || !vz) return input;

    const n = Math.min(x.length, vx.length);
    const positions = new Float32Array(n * 3);
    const vectors = new Float32Array(n * 3);

    for (let i = 0; i < n; i++) {
      positions[i * 3] = x[i];
      positions[i * 3 + 1] = y[i];
      positions[i * 3 + 2] = z[i];
      vectors[i * 3] = vx[i];
      vectors[i * 3 + 1] = vy[i];
      vectors[i * 3 + 2] = vz[i];
    }

    const app = context.app;
    const overlayId = this._overlayId;

    context.postRenderEffects.push(() => {
      if (overlayId && app.overlayManager.get(overlayId)) {
        // Update existing overlay in-place
        const existing = app.overlayManager.get(
          overlayId,
        ) as VectorFieldOverlay;
        existing.update({
          positions,
          vectors,
          scale,
          colorMode,
          color,
          maxArrows,
          shaftRadius,
        });
        app.events.emit("overlay-changed", { overlay: existing });
      } else {
        // Create new overlay
        const overlay = VectorFieldOverlay.create(app.scene, {
          positions,
          vectors,
          scale,
          colorMode,
          color,
          maxArrows,
          shaftRadius,
          name: `VectorField[${this._cfg.vxCol}]`,
        });
        this._overlayId = overlay.id;
        app.overlayManager.add(overlay);
        app.events.emit("overlay-added", { overlay });
      }
    });

    return input;
  }

  /**
   * Clean up the overlay when the modifier is removed from the pipeline.
   * Call this before removing the modifier.
   */
  cleanup(app: { overlayManager: { remove(id: string): void } }): void {
    if (this._overlayId) {
      app.overlayManager.remove(this._overlayId);
      this._overlayId = null;
    }
  }
}
