/**
 * OVITO-style **Replicate**: tile atoms (and bonds) across integer
 * periodic images `nx × ny × nz` along the simulation cell vectors.
 */

import { toRowIndex } from "@molcrafts/molvis-core";
import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { BOND_TYPE_SINGLE, setBondTopology } from "../utils/bond_order";
import { DType } from "../utils/dtype";
import { logger } from "../utils/logger";

export class ReplicateModifier extends BaseModifier {
  static readonly NAME = "Replicate";

  private _nx = 1;
  private _ny = 1;
  private _nz = 1;
  /** When true, scale the simulation cell by (nx, ny, nz). */
  private _adjustBox = true;

  constructor(id = "replicate-default") {
    super(
      id,
      ReplicateModifier.NAME,
      new Set([ModifierCapability.TransformsData]),
    );
  }

  get nx(): number {
    return this._nx;
  }
  get ny(): number {
    return this._ny;
  }
  get nz(): number {
    return this._nz;
  }
  get adjustBox(): boolean {
    return this._adjustBox;
  }

  setCounts(nx: number, ny: number, nz: number): void {
    this._nx = Math.max(1, Math.floor(nx));
    this._ny = Math.max(1, Math.floor(ny));
    this._nz = Math.max(1, Math.floor(nz));
  }

  setAdjustBox(v: boolean): void {
    this._adjustBox = v;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._nx}:${this._ny}:${this._nz}:${this._adjustBox}`;
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    if (this._nx === 1 && this._ny === 1 && this._nz === 1) {
      return input;
    }
    const box = input.box;
    if (!box) {
      logger.warn("Replicate: Frame has no box, skipping");
      return input;
    }
    if (!input.has("atoms")) return input;
    const atoms = input.get("atoms");
    const coords = viewAtomCoords(atoms);
    if (!coords?.x || !coords.y || !coords.z) {
      logger.warn("Replicate: missing coordinates, skipping");
      return input;
    }

    const n0 = atoms.nRows;
    const images = this._nx * this._ny * this._nz;
    const nOut = n0 * images;
    if (nOut === 0) return input;

    const h = box.h().toCopy() as Float64Array;
    const ax = h[0];
    const ay = h[1];
    const az = h[2];
    const bx = h[3];
    const by = h[4];
    const bz = h[5];
    const cx = h[6];
    const cy = h[7];
    const cz = h[8];

    const outX = new Float64Array(nOut);
    const outY = new Float64Array(nOut);
    const outZ = new Float64Array(nOut);
    let ptr = 0;
    for (let ia = 0; ia < this._nx; ia++) {
      for (let ib = 0; ib < this._ny; ib++) {
        for (let ic = 0; ic < this._nz; ic++) {
          const ox = ia * ax + ib * bx + ic * cx;
          const oy = ia * ay + ib * by + ic * cy;
          const oz = ia * az + ib * bz + ic * cz;
          for (let i = 0; i < n0; i++) {
            outX[ptr] = coords.x[i] + ox;
            outY[ptr] = coords.y[i] + oy;
            outZ[ptr] = coords.z[i] + oz;
            ptr++;
          }
        }
      }
    }

    const result = new Frame();
    const tiled = tileAtomsBlock(atoms, n0, images);
    tiled.set(coords.columns.x, outX);
    tiled.set(coords.columns.y, outY);
    tiled.set(coords.columns.z, outZ);
    result.set("atoms", tiled);

    const bonds = input.has("bonds") ? input.get("bonds") : undefined;
    if (bonds && bonds.nRows > 0) {
      const tiledBonds = tileBondsBlock(bonds, n0, images);
      if (tiledBonds) result.set("bonds", tiledBonds);
    }

    for (const name of input.keys()) {
      if (name === "atoms" || name === "bonds") continue;
      const block = input.has(name) ? input.get(name) : undefined;
      if (block) result.set(name, block);
    }

    if (this._adjustBox) {
      try {
        result.box = scaleBox(box, this._nx, this._ny, this._nz);
      } catch (err) {
        logger.warn("Replicate: failed to scale box", err as Error);
        result.box = box;
      }
    } else {
      result.box = box;
    }
    return result;
  }
}

function tileAtomsBlock(atoms: Block, n0: number, images: number): Block {
  const out = new Block();
  const nOut = n0 * images;
  for (const key of atoms.keys()) {
    const dtype = atoms.dtype(key);
    if (dtype === DType.Float) {
      const src = atoms.view(key) as Float64Array;
      if (!src) continue;
      const dst = new Float64Array(nOut);
      for (let g = 0; g < images; g++) {
        dst.set(src.subarray(0, n0), g * n0);
      }
      out.set(key, dst);
    } else if (dtype === DType.String) {
      const src = atoms.copy(key) as string[];
      if (!src) continue;
      const dst: string[] = [];
      for (let g = 0; g < images; g++) {
        for (let i = 0; i < n0; i++) dst.push(src[i]);
      }
      out.set(key, dst);
    } else if (dtype === DType.Int) {
      const src = atoms.view(key) as Int32Array;
      if (!src) continue;
      const dst = new Int32Array(nOut);
      for (let g = 0; g < images; g++) {
        dst.set(src.subarray(0, n0), g * n0);
      }
      out.set(key, dst);
    } else if (dtype === DType.Uint) {
      const src = atoms.view(key) as BigUint64Array;
      if (!src) continue;
      const dst = new BigUint64Array(nOut);
      for (let g = 0; g < images; g++) {
        dst.set(src.subarray(0, n0), g * n0);
      }
      out.set(key, dst);
    }
  }
  return out;
}

function tileBondsBlock(
  bonds: Block,
  n0: number,
  images: number,
): Block | null {
  const atomi = bonds.view("atomi") as BigUint64Array;
  const atomj = bonds.view("atomj") as BigUint64Array;
  if (!atomi || !atomj) return null;
  const nb = bonds.nRows;
  const out = new Block();
  const outI = new Uint32Array(nb * images);
  const outJ = new Uint32Array(nb * images);
  for (let g = 0; g < images; g++) {
    const off = g * n0;
    for (let b = 0; b < nb; b++) {
      outI[g * nb + b] = toRowIndex(atomi[b]) + off;
      outJ[g * nb + b] = toRowIndex(atomj[b]) + off;
    }
  }
  const bondType = bonds.has("bond_type")
    ? (bonds.view("bond_type") as BigUint64Array)
    : undefined;
  const bondNumber = bonds.has("bond_number")
    ? (bonds.view("bond_number") as BigUint64Array)
    : undefined;
  const outT = new Uint32Array(nb * images);
  const outN = new Uint32Array(nb * images);
  for (let g = 0; g < images; g++) {
    for (let b = 0; b < nb; b++) {
      const t = bondType ? toRowIndex(bondType[b]) : BOND_TYPE_SINGLE;
      outT[g * nb + b] = t;
      outN[g * nb + b] = bondNumber ? toRowIndex(bondNumber[b]) : t;
    }
  }
  setBondTopology(out, outI, outJ, outT, outN);
  return out;
}

function scaleBox(box: Box, nx: number, ny: number, nz: number): Box {
  const h = box.h().toCopy() as Float64Array;
  const origin = box.origin().toCopy() as Float64Array;
  const pbc = box.pbc();
  const a = [h[0] * nx, h[1] * nx, h[2] * nx];
  const b = [h[3] * ny, h[4] * ny, h[5] * ny];
  const c = [h[6] * nz, h[7] * nz, h[8] * nz];
  const hRow = new Float64Array([
    a[0],
    b[0],
    c[0],
    a[1],
    b[1],
    c[1],
    a[2],
    b[2],
    c[2],
  ]);
  return new Box(hRow, origin, pbc[0] === 1, pbc[1] === 1, pbc[2] === 1);
}
