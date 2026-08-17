/**
 * OVITO-style **Displacement vectors**: write per-atom MIC displacement
 * columns relative to a reference trajectory frame.
 *
 * Columns: `Displacement.X`, `Displacement.Y`, `Displacement.Z` (Å).
 * Pair with **Vector field** for drawing.
 */

import { type Box, Frame, WasmArray } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { logger } from "../utils/logger";

export const DISPLACEMENT_X = "Displacement.X";
export const DISPLACEMENT_Y = "Displacement.Y";
export const DISPLACEMENT_Z = "Displacement.Z";

export class DisplacementVectorsModifier extends BaseModifier {
  static readonly NAME = "Displacement vectors";

  private _referenceFrame = 0;

  constructor(id = "displacement-vectors-default") {
    super(
      id,
      DisplacementVectorsModifier.NAME,
      new Set([ModifierCapability.TransformsData]),
    );
  }

  get referenceFrame(): number {
    return this._referenceFrame;
  }

  setReferenceFrame(i: number): void {
    this._referenceFrame = Math.max(0, Math.floor(i));
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._referenceFrame}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const atoms = input.getBlock("atoms");
    if (!atoms) return input;
    const coords = viewAtomCoords(atoms);
    if (!coords?.x || !coords.y || !coords.z) {
      logger.warn("Displacement vectors: missing coordinates");
      return input;
    }
    const n = atoms.nrows();

    const traj = context.app?.system?.trajectory;
    let refFrame: Frame | null = null;
    if (traj && typeof traj.get === "function") {
      try {
        refFrame = traj.get(this._referenceFrame) ?? null;
      } catch {
        refFrame = null;
      }
    }
    if (!refFrame) {
      // Unit tests / no traj: zero displacement
      return writeDisplacement(
        input,
        n,
        new Float64Array(n),
        new Float64Array(n),
        new Float64Array(n),
      );
    }

    const refAtoms = refFrame.getBlock("atoms");
    const refCoords = refAtoms ? viewAtomCoords(refAtoms) : null;
    if (
      !refCoords?.x ||
      !refCoords.y ||
      !refCoords.z ||
      refAtoms?.nrows() !== n
    ) {
      logger.warn("Displacement vectors: reference frame mismatch");
      return writeDisplacement(
        input,
        n,
        new Float64Array(n),
        new Float64Array(n),
        new Float64Array(n),
      );
    }

    const box = input.box ?? refFrame.box;
    let dx: Float64Array;
    let dy: Float64Array;
    let dz: Float64Array;
    if (box) {
      const d = micDelta(
        box,
        refCoords.x,
        refCoords.y,
        refCoords.z,
        coords.x,
        coords.y,
        coords.z,
        n,
      );
      dx = d.dx;
      dy = d.dy;
      dz = d.dz;
    } else {
      dx = new Float64Array(n);
      dy = new Float64Array(n);
      dz = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        dx[i] = coords.x[i] - refCoords.x[i];
        dy[i] = coords.y[i] - refCoords.y[i];
        dz[i] = coords.z[i] - refCoords.z[i];
      }
    }

    return writeDisplacement(input, n, dx, dy, dz);
  }
}

function writeDisplacement(
  input: Frame,
  n: number,
  dx: Float64Array,
  dy: Float64Array,
  dz: Float64Array,
): Frame {
  const atoms = input.getBlock("atoms");
  if (!atoms) return input;
  const result = new Frame();
  result.insertBlock("atoms", atoms);
  const out = result.getBlock("atoms");
  if (!out) return input;
  out.setColF(DISPLACEMENT_X, dx.length === n ? dx : new Float64Array(n));
  out.setColF(DISPLACEMENT_Y, dy.length === n ? dy : new Float64Array(n));
  out.setColF(DISPLACEMENT_Z, dz.length === n ? dz : new Float64Array(n));

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

function micDelta(
  box: Box,
  ax: Float64Array,
  ay: Float64Array,
  az: Float64Array,
  bx: Float64Array,
  by: Float64Array,
  bz: Float64Array,
  n: number,
): { dx: Float64Array; dy: Float64Array; dz: Float64Array } {
  const a = new Float64Array(n * 3);
  const b = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    a[i3] = ax[i];
    a[i3 + 1] = ay[i];
    a[i3 + 2] = az[i];
    b[i3] = bx[i];
    b[i3 + 1] = by[i];
    b[i3 + 2] = bz[i];
  }
  const aArr = WasmArray.from(a, new Uint32Array([n, 3]));
  const bArr = WasmArray.from(b, new Uint32Array([n, 3]));
  try {
    const delta = box.delta(aArr, bArr, true);
    try {
      const d = delta.toCopy();
      const dx = new Float64Array(n);
      const dy = new Float64Array(n);
      const dz = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        dx[i] = d[i3];
        dy[i] = d[i3 + 1];
        dz[i] = d[i3 + 2];
      }
      return { dx, dy, dz };
    } finally {
      delta.free();
    }
  } finally {
    aArr.free();
    bArr.free();
  }
}
