/**
 * Cluster center-of-mass markers — reads a chosen `cluster_{N}` mask column.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import {
  computeClusterMaskProperties,
  readClusterMask,
} from "../analysis/cluster_mask";
import type { MolvisApp } from "../app";
import { categoricalColorAt, type LinearRGB } from "../artist/palette";
import {
  type PointMarker,
  PointMarkersOverlay,
} from "../overlays/point_markers";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";

function linearToDisplay(rgb: LinearRGB): [number, number, number] {
  const conv = (c: number) => {
    const x = Math.min(1, Math.max(0, c));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  return [conv(rgb[0]), conv(rgb[1]), conv(rgb[2])];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export class CenterOfMassModifier extends BaseModifier {
  static readonly NAME = "Center of mass";

  /** Empty = auto (latest `cluster_N` on the frame). */
  private _maskColumn = "";
  private _useMassColumn = true;
  private _markerRadius = 0.4;
  private _overlayId: string | null = null;
  private _app: MolvisApp | null = null;

  constructor(id = "com-default") {
    super(id, CenterOfMassModifier.NAME, new Set([ModifierCapability.Draws]));
  }

  get maskColumn(): string {
    return this._maskColumn;
  }
  get useMassColumn(): boolean {
    return this._useMassColumn;
  }
  get markerRadius(): number {
    return this._markerRadius;
  }

  /** Set mask column (e.g. `cluster_1`). Empty string = auto. */
  setMaskColumn(column: string): void {
    this._maskColumn = column.trim();
  }

  setUseMassColumn(on: boolean): void {
    this._useMassColumn = on;
  }

  setMarkerRadius(r: number): void {
    this._markerRadius = Math.max(0.05, r);
  }

  matches(_frame: Frame): boolean {
    return false;
  }

  isApplicable(frame: Frame): boolean {
    return readClusterMask(frame, this._maskColumn || null) !== null;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:col=${this._maskColumn}:massCol=${this._useMassColumn}:r=${this._markerRadius}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    if (!this.enabled) return input;
    this._app = context.app;

    const resolved = readClusterMask(input, this._maskColumn || null);
    if (!resolved) {
      this._clearOverlay(context.app);
      return input;
    }
    const { mask, column } = resolved;

    const props = computeClusterMaskProperties(
      input,
      mask,
      { useMassColumn: this._useMassColumn },
      column,
    );
    if (!props || props.numClusters === 0) {
      this._clearOverlay(context.app);
      return input;
    }

    const points: PointMarker[] = [];
    for (let c = 0; c < props.numClusters; c++) {
      const [r, g, b] = linearToDisplay(
        categoricalColorAt(props.clusterIds[c]),
      );
      points.push({
        position: [
          props.centersOfMass[c * 3],
          props.centersOfMass[c * 3 + 1],
          props.centersOfMass[c * 3 + 2],
        ],
        color: rgbToHex(r, g, b),
        radius: this._markerRadius,
      });
    }

    const app = context.app;
    const overlayId = this._overlayId;
    const radius = this._markerRadius;

    context.postRenderEffects.push(() => {
      if (overlayId && app.overlayManager.get(overlayId)) {
        const existing = app.overlayManager.get(
          overlayId,
        ) as PointMarkersOverlay;
        existing.update({
          points,
          radius,
          name: "ClusterCOM",
        });
        app.events.emit("overlay-changed", { overlay: existing });
      } else {
        const overlay = PointMarkersOverlay.create(app.scene, {
          points,
          radius,
          name: "ClusterCOM",
        });
        this._overlayId = overlay.id;
        app.overlayManager.add(overlay);
        app.events.emit("overlay-added", { overlay });
      }
    });

    return input;
  }

  applyVisibility(app: MolvisApp, visible: boolean): void {
    if (!this._overlayId) return;
    const o = app.overlayManager.get(this._overlayId);
    if (o) o.visible = visible;
  }

  onRemoved(): void {
    if (this._app && this._overlayId) {
      this._app.overlayManager.remove(this._overlayId);
      this._overlayId = null;
    }
    this._app = null;
  }

  private _clearOverlay(app: MolvisApp): void {
    if (this._overlayId) {
      app.overlayManager.remove(this._overlayId);
      this._overlayId = null;
    }
  }
}
