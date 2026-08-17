/**
 * OVITO-style Affine transformation: apply a linear map + translation
 * to atom coordinates (and optionally to the simulation cell).
 *
 * x' = M · x + t  (Å). Matrix is row-major 3×3; translation is (tx, ty, tz).
 */

import { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { logger } from "../utils/logger";

export type AffineMatrix3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

const IDENTITY: AffineMatrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export class AffineTransformationModifier extends BaseModifier {
  static readonly NAME = "Affine transformation";

  private _matrix: AffineMatrix3 = [...IDENTITY];
  private _translation: [number, number, number] = [0, 0, 0];
  /** When true, also transform the simulation cell vectors (if present). */
  private _transformCell = true;

  constructor(id = "affine-transformation-default") {
    super(
      id,
      AffineTransformationModifier.NAME,
      new Set([ModifierCapability.TransformsData]),
    );
  }

  get matrix(): Readonly<AffineMatrix3> {
    return this._matrix;
  }

  get translation(): readonly [number, number, number] {
    return this._translation;
  }

  get transformCell(): boolean {
    return this._transformCell;
  }

  setMatrix(m: ReadonlyArray<number>): void {
    if (m.length !== 9) return;
    this._matrix = [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]];
  }

  setTranslation(t: readonly [number, number, number]): void {
    this._translation = [t[0], t[1], t[2]];
  }

  setTransformCell(v: boolean): void {
    this._transformCell = v;
  }

  /** Uniform scale about the origin (replaces matrix). */
  setUniformScale(s: number): void {
    const f = Number.isFinite(s) && s !== 0 ? s : 1;
    this._matrix = [f, 0, 0, 0, f, 0, 0, 0, f];
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._matrix.join(",")}:${this._translation.join(",")}:${this._transformCell}`;
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    const atoms = input.getBlock("atoms");
    if (!atoms) return input;
    const coords = viewAtomCoords(atoms);
    if (!coords?.x || !coords.y || !coords.z) {
      logger.warn("Affine transformation: missing coordinates, skipping");
      return input;
    }

    const n = atoms.nrows();
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = this._matrix;
    const [tx, ty, tz] = this._translation;
    const ox = new Float64Array(n);
    const oy = new Float64Array(n);
    const oz = new Float64Array(n);
    const ix = coords.x;
    const iy = coords.y;
    const iz = coords.z;
    for (let i = 0; i < n; i++) {
      const x = ix[i];
      const y = iy[i];
      const z = iz[i];
      ox[i] = m00 * x + m01 * y + m02 * z + tx;
      oy[i] = m10 * x + m11 * y + m12 * z + ty;
      oz[i] = m20 * x + m21 * y + m22 * z + tz;
    }

    const result = new Frame();
    result.insertBlock("atoms", atoms);
    const outAtoms = result.getBlock("atoms");
    if (!outAtoms) return input;
    outAtoms.setColF(coords.columns.x, ox);
    outAtoms.setColF(coords.columns.y, oy);
    outAtoms.setColF(coords.columns.z, oz);

    const bonds = input.getBlock("bonds");
    if (bonds) result.insertBlock("bonds", bonds);
    for (const name of input.blockNames()) {
      if (name === "atoms" || name === "bonds") continue;
      const block = input.getBlock(name);
      if (block) result.insertBlock(name, block);
    }

    if (input.box) {
      if (this._transformCell) {
        try {
          result.box = transformBox(input.box, this._matrix, this._translation);
        } catch (err) {
          logger.warn(
            "Affine transformation: failed to transform cell, keeping original",
            err as Error,
          );
          result.box = input.box;
        }
      } else {
        result.box = input.box;
      }
    }
    return result;
  }
}

/**
 * Apply M to lattice vectors (columns of hMatrix) and origin: o' = M·o + t.
 * Box constructor expects row-major H.
 */
function transformBox(
  box: Box,
  m: AffineMatrix3,
  t: readonly [number, number, number],
): Box {
  const hCol = box.hMatrix().toCopy() as Float64Array; // column-major length 9
  const origin = box.origin().toCopy() as Float64Array;
  const pbc = box.pbc();
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;

  // Lattice vectors a,b,c are columns of hCol.
  const mulCol = (c: number): [number, number, number] => {
    const x = hCol[c * 3];
    const y = hCol[c * 3 + 1];
    const z = hCol[c * 3 + 2];
    return [
      m00 * x + m01 * y + m02 * z,
      m10 * x + m11 * y + m12 * z,
      m20 * x + m21 * y + m22 * z,
    ];
  };
  const a = mulCol(0);
  const b = mulCol(1);
  const c = mulCol(2);
  // Row-major for Box constructor: rows are [ax ay az; bx by bz; cx cy cz]
  // Wait — constructor docs say row-major [h00,h01,h02, h10,h11,h12, h20,h21,h22]
  // and hMatrix columns are lattice vectors. So h00=ax, h10=ay, h20=az for col0.
  // Row-major layout: [ax, bx, cx, ay, by, cy, az, bz, cz] if rows are coordinates?
  // Docs: row-major [h00, h01, h02, h10, h11, h12, h20, h21, h22]
  // hMatrix col-major: [h00, h10, h20, h01, h11, h21, h02, h12, h22]
  // So row-major from columns: [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]]
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
  const oNew = new Float64Array([
    m00 * origin[0] + m01 * origin[1] + m02 * origin[2] + t[0],
    m10 * origin[0] + m11 * origin[1] + m12 * origin[2] + t[1],
    m20 * origin[0] + m21 * origin[1] + m22 * origin[2] + t[2],
  ]);
  return new Box(hRow, oNew, pbc[0] === 1, pbc[1] === 1, pbc[2] === 1);
}
