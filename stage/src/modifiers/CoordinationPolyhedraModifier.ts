/**
 * OVITO-style **Coordination polyhedra**: wireframe polyhedra connecting
 * neighbors of each center atom within cutoff.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import {
  buildPolyhedronEdges,
  edgesToLinePoints,
} from "../algo/coord_polyhedra";
import { SpatialNeighborQuery } from "../algo/neighbor_list";
import { viewAtomCoords } from "../io/atom_coords";
import { LineSystemOverlay } from "../overlays/line_system";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";

export class CoordinationPolyhedraModifier extends BaseModifier {
  static readonly NAME = "Coordination polyhedra";

  private _cutoff = 3.0;
  private _onlySelection = false;
  private _color = "#66ccff";
  private _opacity = 0.85;
  private _overlayId: string | null = null;

  constructor(id = "coord-polyhedra-default") {
    super(
      id,
      CoordinationPolyhedraModifier.NAME,
      new Set([ModifierCapability.Draws]),
    );
  }

  get cutoff(): number {
    return this._cutoff;
  }
  get onlySelection(): boolean {
    return this._onlySelection;
  }
  get color(): string {
    return this._color;
  }
  get opacity(): number {
    return this._opacity;
  }

  setCutoff(v: number): void {
    this._cutoff = Math.max(0.1, v);
  }
  setOnlySelection(v: boolean): void {
    this._onlySelection = v;
  }
  setColor(v: string): void {
    this._color = v;
  }
  setOpacity(v: number): void {
    this._opacity = Math.max(0, Math.min(1, v));
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._cutoff}:${this._onlySelection}:${this._color}:${this._opacity}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    if (!this.enabled) return input;
    const atoms = input.getBlock("atoms");
    if (!atoms) return input;
    const coords = viewAtomCoords(atoms);
    if (!coords?.x || !coords.y || !coords.z) return input;
    const n = atoms.nrows();

    const positions = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = coords.x[i];
      positions[i * 3 + 1] = coords.y[i];
      positions[i * 3 + 2] = coords.z[i];
    }

    // Neighbor graph via SpatialNeighborQuery (LinkedCell)
    const adj: number[][] = Array.from({ length: n }, () => []);
    const query = new SpatialNeighborQuery(this._cutoff);
    let neighbors: ReturnType<SpatialNeighborQuery["build"]> | null = null;
    try {
      neighbors = query.build(input);
      const qi = new Uint32Array(neighbors.queryPointIndices());
      const pj = new Uint32Array(neighbors.pointIndices());
      for (let p = 0; p < qi.length; p++) {
        const i = qi[p];
        const j = pj[p];
        if (i < n && j < n) {
          adj[i].push(j);
          adj[j].push(i);
        }
      }
    } catch {
      neighbors?.free();
      query.free();
      return input;
    }
    neighbors?.free();
    query.free();

    let centers: number[];
    if (this._onlySelection) {
      centers = context.currentSelection.getIndices().filter((i) => i < n);
    } else {
      centers = Array.from({ length: n }, (_, i) => i);
    }
    // Cap centers for performance
    const maxCenters = 500;
    if (centers.length > maxCenters) centers = centers.slice(0, maxCenters);

    const neighborLists = centers.map((c) => adj[c]);
    const edges = buildPolyhedronEdges(positions, centers, neighborLists);
    const lines = edgesToLinePoints(edges);

    const app = context.app;
    const overlayId = this._overlayId;
    const color = this._color;
    const opacity = this._opacity;

    context.postRenderEffects.push(() => {
      if (overlayId && app.overlayManager.get(overlayId)) {
        const existing = app.overlayManager.get(overlayId) as LineSystemOverlay;
        existing.update({ lines, color, opacity, name: "CoordPolyhedra" });
        app.events.emit("overlay-changed", { overlay: existing });
      } else {
        const overlay = LineSystemOverlay.create(app.scene, {
          lines,
          color,
          opacity,
          name: "CoordPolyhedra",
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
