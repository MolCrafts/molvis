/**
 * Cluster analysis → per-atom `cluster_{maskId}` (+ optional scene color).
 *
 * Downstream COM / Rg only read a chosen mask column; they never re-cluster.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import { type ConnectivityMode, computeClusters } from "../analysis/cluster";
import {
  CLUSTER_COLUMN_PREFIX,
  clusterColumnName,
} from "../analysis/cluster_mask";
import { categoricalColorAt } from "../artist/palette";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { logger } from "../utils/logger";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "./ColorByPropertyModifier";
import { cloneFrameWithAtoms } from "./structure_order_shared";

export { CLUSTER_COLUMN_PREFIX, clusterColumnName };

export class ClusterModifier extends BaseModifier {
  static readonly NAME = "Cluster";

  /** 1-based mask id → column `cluster_{id}`. */
  private _slot = 1;
  private _mode: ConnectivityMode = "cutoff";
  private _rMax = 3.2;
  /** When true (default), stamp categorical `__color_*` from this mask. */
  private _colorScene = true;

  constructor(id = "cluster-default", slot = 1) {
    super(
      id,
      ClusterModifier.NAME,
      new Set([
        ModifierCapability.TransformsData,
        ModifierCapability.ConsumesSelection,
      ]),
    );
    this._slot = Math.max(1, Math.floor(slot));
  }

  override get name(): string {
    return `Cluster ${this._slot}`;
  }

  get slot(): number {
    return this._slot;
  }

  get columnName(): string {
    return clusterColumnName(this._slot);
  }

  get mode(): ConnectivityMode {
    return this._mode;
  }
  get rMax(): number {
    return this._rMax;
  }
  get colorScene(): boolean {
    return this._colorScene;
  }

  /** @deprecated always 1 — one atom is a cluster. */
  get minClusterSize(): number {
    return 1;
  }
  /** @deprecated sorting is a table concern, not compute. */
  get sortBySize(): boolean {
    return false;
  }

  setSlot(slot: number): void {
    if (!Number.isFinite(slot)) return;
    this._slot = Math.max(1, Math.floor(slot));
  }

  setMode(mode: ConnectivityMode): void {
    this._mode = mode === "bonds" ? "bonds" : "cutoff";
  }

  setRMax(v: number): void {
    this._rMax = Math.max(0.05, v);
  }

  setMinClusterSize(_v: number): void {
    // no-op — min size is always 1
  }

  setSortBySize(_on: boolean): void {
    // no-op — table headers sort, not the mask writer
  }

  setColorScene(on: boolean): void {
    this._colorScene = on;
  }

  matches(_frame: Frame): boolean {
    return false;
  }

  isApplicable(frame: Frame): boolean {
    const atoms = frame.getBlock("atoms");
    return !!atoms && atoms.nrows() > 0;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:slot=${this._slot}:${this._mode}:${this._rMax}:color=${this._colorScene}:scope=${this.selectionScopeId ?? ""}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    if (!this.enabled || !this.isApplicable(input)) return input;

    const n = input.getBlock("atoms")?.nrows() ?? 0;
    let selectedIndices: number[] | undefined;
    if (this.selectionScopeId) {
      const idxs = context.currentSelection.getIndices().filter((i) => i < n);
      if (idxs.length > 0) selectedIndices = idxs;
    }

    const result = computeClusters(input, {
      mode: this._mode,
      rMax: this._mode === "cutoff" ? this._rMax : undefined,
      minClusterSize: 1,
      sortBySize: false,
      selectedIndices,
    });

    if (!result) {
      logger.warn("[Cluster] compute returned null");
      return input;
    }

    const out = cloneFrameWithAtoms(input);
    if (!out) return input;
    const atoms = out.getBlock("atoms");
    if (!atoms) return input;

    atoms.setColI32(this.columnName, Int32Array.from(result.clusterIdx));

    if (this._colorScene) {
      const colorR = new Float64Array(n);
      const colorG = new Float64Array(n);
      const colorB = new Float64Array(n);
      const unassigned: [number, number, number] = [0.55, 0.55, 0.58];
      for (let i = 0; i < n; i++) {
        const cid = result.clusterIdx[i];
        const strategy = context.app?.styleManager?.getCategoricalStrategy();
        const rgb = cid >= 0 ? categoricalColorAt(cid, strategy) : unassigned;
        colorR[i] = rgb[0];
        colorG[i] = rgb[1];
        colorB[i] = rgb[2];
      }
      atoms.setColF(COLOR_OVERRIDE_R, colorR);
      atoms.setColF(COLOR_OVERRIDE_G, colorG);
      atoms.setColF(COLOR_OVERRIDE_B, colorB);
    }

    return out;
  }
}
