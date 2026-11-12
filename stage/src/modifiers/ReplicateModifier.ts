/**
 * OVITO-style **Replicate**: tile atoms (and bonds) across integer
 * periodic images `nx × ny × nz` along the simulation cell vectors.
 */

import { toRowIndex } from "@molcrafts/molvis-core";
import { Block, Box, Cell, Frame, NDArray } from "@molcrafts/molvis-core/molrs";
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

    // `view` is a window onto WASM memory and detaches when that memory
    // grows. Copy the coordinates out before tiling allocates.
    const x0 = new Float64Array(coords.x);
    const y0 = new Float64Array(coords.y);
    const z0 = new Float64Array(coords.z);

    // Box.h() is row-major with lattice vectors as columns.
    const h = copyArray(box.h());
    const ax = h[0];
    const ay = h[3];
    const az = h[6];
    const bx = h[1];
    const by = h[4];
    const bz = h[7];
    const cx = h[2];
    const cy = h[5];
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
            outX[ptr] = x0[i] + ox;
            outY[ptr] = y0[i] + oy;
            outZ[ptr] = z0[i] + oz;
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
      const shift = bondLatticeShift(box, x0, y0, z0, bonds);
      const tiledBonds = tileBondsBlock(
        bonds,
        n0,
        this._nx,
        this._ny,
        this._nz,
        shift,
      );
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

/**
 * Integer cell shift `k` removed by the minimum image of `r_j − r_i`, so
 * `r_j − H·k` is the image of `j` actually bonded to `i`. Zero when the
 * stored pair is already the nearest image. Empty when the bonds block has
 * no endpoints or the cell displacement cannot be computed.
 */
function bondLatticeShift(
  box: Box,
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  bonds: Block,
): Int32Array | null {
  const atomi = bonds.view("atomi") as BigUint64Array;
  const atomj = bonds.view("atomj") as BigUint64Array;
  if (!atomi || !atomj) return null;
  const nb = bonds.nRows;
  const shift = new Int32Array(nb * 3);
  if (nb === 0) return shift;

  const flatLen = nb * 3;
  const aBuf = new Float64Array(flatLen);
  const bBuf = new Float64Array(flatLen);
  // Endpoint rows are read once, before `delta` allocates and can detach
  // the column view.
  for (let b = 0; b < nb; b++) {
    const i = toRowIndex(atomi[b]);
    const j = toRowIndex(atomj[b]);
    const o = 3 * b;
    aBuf[o] = x[i];
    aBuf[o + 1] = y[i];
    aBuf[o + 2] = z[i];
    bBuf[o] = x[j];
    bBuf[o + 1] = y[j];
    bBuf[o + 2] = z[j];
  }

  const shape = new Uint32Array([nb, 3]);
  const aArr = NDArray.from(aBuf, shape);
  const bArr = NDArray.from(bBuf, shape);
  let mi: Float64Array;
  try {
    const delta = box.delta(aArr, bArr, true);
    try {
      mi = delta.toCopy() as Float64Array;
    } finally {
      delta.free();
    }
  } catch (err) {
    logger.warn(
      "Replicate: bond image unavailable, tiling inside each copy",
      err as Error,
    );
    return null;
  } finally {
    aArr.free();
    bArr.free();
  }

  // Convert lattice displacements with the native cell transform. toFrac
  // subtracts the origin, so add it to each displacement first.
  const origin = copyArray(box.origin());
  for (let o = 0; o < flatLen; o++) {
    bBuf[o] = bBuf[o] - aBuf[o] - mi[o] + origin[o % 3];
  }
  const lattice = NDArray.from(bBuf, shape);
  let fractions: Float64Array;
  try {
    fractions = copyArray(box.toFrac(lattice));
  } finally {
    lattice.free();
  }
  for (let o = 0; o < flatLen; o++) {
    const value = Math.round(fractions[o]);
    if (!Number.isFinite(value)) {
      throw new Error("Replicate: bond image is not finite");
    }
    shift[o] = value;
  }
  return shift;
}

/** Copy an ephemeral WASM array out and drop the handle. */
function copyArray(matrix: {
  toCopy(): Float64Array;
  free(): void;
}): Float64Array {
  try {
    return matrix.toCopy();
  } finally {
    matrix.free();
  }
}

function copyRowIndex(column: BigUint64Array, n: number): Uint32Array {
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = toRowIndex(column[i]);
  return out;
}

function wrapReplica(index: number, count: number): number {
  const mod = index % count;
  return mod < 0 ? mod + count : mod;
}

function tileBondsBlock(
  bonds: Block,
  n0: number,
  nx: number,
  ny: number,
  nz: number,
  shift: Int32Array | null,
): Block | null {
  const atomi = bonds.view("atomi") as BigUint64Array;
  const atomj = bonds.view("atomj") as BigUint64Array;
  if (!atomi || !atomj) return null;
  const nb = bonds.nRows;
  // Copy the columns out before `new Block()` allocates. A growth detaches
  // every live WASM view, and the next index read would be `undefined`.
  const srcI = copyRowIndex(atomi, nb);
  const srcJ = copyRowIndex(atomj, nb);
  const srcT = bonds.has("bond_type")
    ? copyRowIndex(bonds.view("bond_type") as BigUint64Array, nb)
    : undefined;
  const srcN = bonds.has("bond_number")
    ? copyRowIndex(bonds.view("bond_number") as BigUint64Array, nb)
    : undefined;
  const images = nx * ny * nz;
  const out = new Block();
  const outI = new Uint32Array(nb * images);
  const outJ = new Uint32Array(nb * images);
  // Same image order as the atom tile: ia, then ib, then ic.
  // A crossing bond leaves i in replica s and puts j in replica s−k,
  // wrapped into the tile, so the two copies are joined by one stick.
  let g = 0;
  for (let ia = 0; ia < nx; ia++) {
    for (let ib = 0; ib < ny; ib++) {
      for (let ic = 0; ic < nz; ic++) {
        for (let b = 0; b < nb; b++) {
          const o = 3 * b;
          const kx = shift ? shift[o] : 0;
          const ky = shift ? shift[o + 1] : 0;
          const kz = shift ? shift[o + 2] : 0;
          const ja = wrapReplica(ia - kx, nx);
          const jb = wrapReplica(ib - ky, ny);
          const jc = wrapReplica(ic - kz, nz);
          const gj = (ja * ny + jb) * nz + jc;
          const row = g * nb + b;
          outI[row] = srcI[b] + g * n0;
          outJ[row] = srcJ[b] + gj * n0;
        }
        g++;
      }
    }
  }
  const outT = new Uint32Array(nb * images);
  const outN = new Uint32Array(nb * images);
  for (let g = 0; g < images; g++) {
    for (let b = 0; b < nb; b++) {
      const t = srcT ? srcT[b] : BOND_TYPE_SINGLE;
      outT[g * nb + b] = t;
      outN[g * nb + b] = srcN ? srcN[b] : t;
    }
  }
  setBondTopology(out, outI, outJ, outT, outN);
  return out;
}

function scaleBox(box: Box, nx: number, ny: number, nz: number): Box {
  // Box.h() is row-major with lattice vectors as columns; scale each column.
  const h = copyArray(box.h());
  const origin = copyArray(box.origin());
  const pbc = box.pbc();
  const hRow = new Float64Array([
    h[0] * nx,
    h[1] * ny,
    h[2] * nz,
    h[3] * nx,
    h[4] * ny,
    h[5] * nz,
    h[6] * nx,
    h[7] * ny,
    h[8] * nz,
  ]);
  return new Box(Cell.matrix(hRow), origin, pbc);
}
