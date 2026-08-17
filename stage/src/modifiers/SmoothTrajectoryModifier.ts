/**
 * OVITO-style **Smooth trajectory**: average atom coordinates over a
 * sliding window of neighboring trajectory frames (center = current).
 */

import { Frame } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { logger } from "../utils/logger";

export class SmoothTrajectoryModifier extends BaseModifier {
  static readonly NAME = "Smooth trajectory";

  /** Half-window size: window = 2*windowHalf + 1 frames (default 1 → 3-frame average). */
  private _windowHalf = 1;

  constructor(id = "smooth-trajectory-default") {
    super(
      id,
      SmoothTrajectoryModifier.NAME,
      new Set([ModifierCapability.TransformsData]),
    );
  }

  get windowHalf(): number {
    return this._windowHalf;
  }

  setWindowHalf(v: number): void {
    this._windowHalf = Math.max(0, Math.floor(v));
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._windowHalf}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    if (this._windowHalf === 0) return input;

    const traj = context.app?.system?.trajectory;
    if (!traj || typeof traj.length !== "number" || traj.length < 2) {
      logger.warn("Smooth trajectory: need multi-frame trajectory");
      return input;
    }

    const atoms = input.getBlock("atoms");
    if (!atoms) return input;
    const coords = viewAtomCoords(atoms);
    if (!coords?.x || !coords.y || !coords.z) return input;
    const n = atoms.nrows();
    const frameIndex = context.frameIndex ?? 0;
    const len = traj.length;
    const i0 = Math.max(0, frameIndex - this._windowHalf);
    const i1 = Math.min(len - 1, frameIndex + this._windowHalf);

    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    const sz = new Float64Array(n);
    let count = 0;

    for (let f = i0; f <= i1; f++) {
      let fr: Frame | null = null;
      try {
        fr = traj.get(f) ?? null;
      } catch {
        fr = null;
      }
      if (!fr) continue;
      const a = fr.getBlock("atoms");
      const c = a ? viewAtomCoords(a) : null;
      if (!c?.x || !c.y || !c.z || !a || a.nrows() !== n) continue;
      for (let i = 0; i < n; i++) {
        sx[i] += c.x[i];
        sy[i] += c.y[i];
        sz[i] += c.z[i];
      }
      count++;
    }

    if (count === 0) return input;
    const inv = 1 / count;
    for (let i = 0; i < n; i++) {
      sx[i] *= inv;
      sy[i] *= inv;
      sz[i] *= inv;
    }

    const result = new Frame();
    result.insertBlock("atoms", atoms);
    const out = result.getBlock("atoms");
    if (!out) return input;
    out.setColF(coords.columns.x, sx);
    out.setColF(coords.columns.y, sy);
    out.setColF(coords.columns.z, sz);

    const bonds = input.getBlock("bonds");
    if (bonds) result.insertBlock("bonds", bonds);
    for (const name of input.blockNames()) {
      if (name === "atoms" || name === "bonds") continue;
      const block = input.getBlock(name);
      if (block) result.insertBlock(name, block);
    }
    if (input.box) result.box = input.box;
    return result;
  }
}
