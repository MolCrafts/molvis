/**
 * Per-cluster radius of gyration as wireframe spheres — reads `cluster_{N}`.
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
import { RegionWireframeOverlay } from "../overlays/region_wireframe";
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

export class RadiusOfGyrationModifier extends BaseModifier {
  static readonly NAME = "Radius of gyration";

  /** Empty = auto (latest `cluster_N` on the frame). */
  private _maskColumn = "";
  private _useMassColumn = true;
  private _showCenters = true;
  private _markerRadius = 0.3;
  private _wireOpacity = 0.55;
  private _centerOverlayId: string | null = null;
  private _sphereOverlayIds: string[] = [];
  private _app: MolvisApp | null = null;

  constructor(id = "rg-default") {
    super(
      id,
      RadiusOfGyrationModifier.NAME,
      new Set([ModifierCapability.Draws]),
    );
  }

  get maskColumn(): string {
    return this._maskColumn;
  }
  get useMassColumn(): boolean {
    return this._useMassColumn;
  }
  get showCenters(): boolean {
    return this._showCenters;
  }
  get markerRadius(): number {
    return this._markerRadius;
  }
  get wireOpacity(): number {
    return this._wireOpacity;
  }

  setMaskColumn(column: string): void {
    this._maskColumn = column.trim();
  }

  setUseMassColumn(on: boolean): void {
    this._useMassColumn = on;
  }

  setShowCenters(on: boolean): void {
    this._showCenters = on;
  }

  setMarkerRadius(r: number): void {
    this._markerRadius = Math.max(0.05, r);
  }

  setWireOpacity(o: number): void {
    this._wireOpacity = Math.max(0, Math.min(1, o));
  }

  matches(_frame: Frame): boolean {
    return false;
  }

  isApplicable(frame: Frame): boolean {
    return readClusterMask(frame, this._maskColumn || null) !== null;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:col=${this._maskColumn}:massCol=${this._useMassColumn}:ctr=${this._showCenters}:r=${this._markerRadius}:op=${this._wireOpacity}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    if (!this.enabled) return input;
    this._app = context.app;

    const resolved = readClusterMask(input, this._maskColumn || null);
    if (!resolved) {
      this._clearOverlays(context.app);
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
      this._clearOverlays(context.app);
      return input;
    }

    const points: PointMarker[] = [];
    const spheres: Array<{
      center: [number, number, number];
      radius: number;
      color: string;
    }> = [];

    for (let c = 0; c < props.numClusters; c++) {
      const [r, g, b] = linearToDisplay(
        categoricalColorAt(props.clusterIds[c]),
      );
      const color = rgbToHex(r, g, b);
      const center: [number, number, number] = [
        props.centersOfMass[c * 3],
        props.centersOfMass[c * 3 + 1],
        props.centersOfMass[c * 3 + 2],
      ];
      const rg = props.radiiOfGyration[c];
      if (this._showCenters) {
        points.push({
          position: center,
          color,
          radius: this._markerRadius,
        });
      }
      if (rg > 1e-6) {
        spheres.push({ center, radius: rg, color });
      }
    }

    const app = context.app;
    const centerOverlayId = this._centerOverlayId;
    const oldSphereIds = [...this._sphereOverlayIds];
    const showCenters = this._showCenters;
    const markerRadius = this._markerRadius;
    const wireOpacity = this._wireOpacity;

    context.postRenderEffects.push(() => {
      // Centers
      if (showCenters && points.length > 0) {
        if (centerOverlayId && app.overlayManager.get(centerOverlayId)) {
          const existing = app.overlayManager.get(
            centerOverlayId,
          ) as PointMarkersOverlay;
          existing.update({
            points,
            radius: markerRadius,
            name: "ClusterRgCenters",
          });
          app.events.emit("overlay-changed", { overlay: existing });
        } else {
          const overlay = PointMarkersOverlay.create(app.scene, {
            points,
            radius: markerRadius,
            name: "ClusterRgCenters",
          });
          this._centerOverlayId = overlay.id;
          app.overlayManager.add(overlay);
          app.events.emit("overlay-added", { overlay });
        }
      } else if (centerOverlayId) {
        app.overlayManager.remove(centerOverlayId);
        this._centerOverlayId = null;
      }

      // Wireframe spheres — recreate each pass (radii change often)
      for (const id of oldSphereIds) {
        app.overlayManager.remove(id);
      }
      this._sphereOverlayIds = [];
      for (let i = 0; i < spheres.length; i++) {
        const s = spheres[i];
        const overlay = new RegionWireframeOverlay(
          `rg-sphere-${this.id}-${i}`,
          {
            kind: "sphere",
            center: s.center,
            radius: s.radius,
            color: s.color,
            opacity: wireOpacity,
            latitudes: 9,
            longitudes: 14,
            segments: 36,
          },
          app.scene,
        );
        app.overlayManager.add(overlay);
        this._sphereOverlayIds.push(overlay.id);
        app.events.emit("overlay-added", { overlay });
      }
    });

    return input;
  }

  applyVisibility(app: MolvisApp, visible: boolean): void {
    if (this._centerOverlayId) {
      const o = app.overlayManager.get(this._centerOverlayId);
      if (o) o.visible = visible;
    }
    for (const id of this._sphereOverlayIds) {
      const o = app.overlayManager.get(id);
      if (o) o.visible = visible;
    }
  }

  onRemoved(): void {
    if (this._app) {
      this._clearOverlays(this._app);
    }
    this._app = null;
  }

  private _clearOverlays(app: MolvisApp): void {
    if (this._centerOverlayId) {
      app.overlayManager.remove(this._centerOverlayId);
      this._centerOverlayId = null;
    }
    for (const id of this._sphereOverlayIds) {
      app.overlayManager.remove(id);
    }
    this._sphereOverlayIds = [];
  }
}
