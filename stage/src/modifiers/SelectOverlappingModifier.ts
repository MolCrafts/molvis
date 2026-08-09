/**
 * OVITO-style **Select overlapping**: select atoms that have at least
 * one neighbor within `cutoff` (Å).
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import { SpatialNeighborQuery } from "../algo/neighbor_list";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { SelectionMask } from "../pipeline/types";

export class SelectOverlappingModifier extends BaseModifier {
  static readonly NAME = "Select overlapping";

  private _cutoff = 0.5;

  constructor(id = "select-overlapping-default") {
    super(
      id,
      SelectOverlappingModifier.NAME,
      new Set([ModifierCapability.ProducesSelection]),
    );
  }

  get cutoff(): number {
    return this._cutoff;
  }

  setCutoff(v: number): void {
    this._cutoff = Math.max(1e-6, v);
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._cutoff}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const atoms = input.getBlock("atoms");
    if (!atoms) {
      context.currentSelection = SelectionMask.none(0);
      return input;
    }
    const n = atoms.nrows();
    if (n === 0) {
      context.currentSelection = SelectionMask.none(0);
      return input;
    }

    const hit = new Uint8Array(n);
    const query = new SpatialNeighborQuery(this._cutoff);
    let neighbors: ReturnType<SpatialNeighborQuery["build"]> | null = null;
    try {
      neighbors = query.build(input);
      const qi = new Uint32Array(neighbors.queryPointIndices());
      const pj = new Uint32Array(neighbors.pointIndices());
      for (let p = 0; p < qi.length; p++) {
        hit[qi[p]] = 1;
        hit[pj[p]] = 1;
      }
    } catch {
      // no coords / wasm — empty selection
    } finally {
      neighbors?.free();
      query.free();
    }

    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      if (hit[i]) indices.push(i);
    }
    const mask = SelectionMask.fromIndices(n, indices);
    context.currentSelection = mask;
    context.selectionSet.set(this.id, mask);
    return input;
  }
}
