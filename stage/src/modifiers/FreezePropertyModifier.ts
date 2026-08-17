/**
 * OVITO-style **Freeze property**: snapshot a column on first run and
 * re-apply those values on later frames (index-aligned).
 */

import { type Block, Frame } from "@molcrafts/molvis-core/molrs";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { DType, isFloatDtype } from "../utils/dtype";
import { logger } from "../utils/logger";

type Frozen =
  | { kind: "f64"; data: Float64Array }
  | { kind: "str"; data: string[] }
  | { kind: "i32"; data: Int32Array }
  | { kind: "u32"; data: Uint32Array };

export class FreezePropertyModifier extends BaseModifier {
  static readonly NAME = "Freeze property";

  private _column = "";
  private _frozen: Frozen | null = null;

  constructor(id = "freeze-property-default") {
    super(
      id,
      FreezePropertyModifier.NAME,
      new Set([ModifierCapability.TransformsData]),
    );
  }

  get column(): string {
    return this._column;
  }

  setColumn(name: string): void {
    const t = name.trim();
    if (t !== this._column) {
      this._column = t;
      this._frozen = null;
    }
  }

  clearFreeze(): void {
    this._frozen = null;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._column}:frozen=${this._frozen !== null}`;
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    if (!this._column) return input;
    const atoms = input.getBlock("atoms");
    if (!atoms) return input;
    const n = atoms.nrows();
    if (n === 0) return input;

    if (!this._frozen || frozenLength(this._frozen) !== n) {
      const snap = snapshotColumn(atoms, this._column, n);
      if (!snap) {
        logger.warn(
          `Freeze property: column "${this._column}" missing, skipping`,
        );
        return input;
      }
      this._frozen = snap;
    }

    const result = new Frame();
    result.insertBlock("atoms", atoms);
    const outAtoms = result.getBlock("atoms");
    if (!outAtoms) return input;
    writeFrozen(outAtoms, this._column, this._frozen);

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

function frozenLength(f: Frozen): number {
  return f.data.length;
}

function snapshotColumn(
  atoms: Block,
  column: string,
  n: number,
): Frozen | null {
  const dtype = atoms.dtype(column);
  if (!dtype) return null;
  if (isFloatDtype(dtype)) {
    const src = atoms.viewColF(column);
    if (!src || src.length < n) return null;
    return { kind: "f64", data: new Float64Array(src.subarray(0, n)) };
  }
  if (dtype === DType.String) {
    const src = atoms.copyColStr(column) as string[] | undefined;
    if (!src) return null;
    return { kind: "str", data: [...src] };
  }
  if (dtype === DType.I32) {
    const src = atoms.viewColI32(column);
    if (!src) return null;
    return { kind: "i32", data: new Int32Array(src.subarray(0, n)) };
  }
  if (dtype === DType.U32) {
    const src = atoms.viewColU32(column);
    if (!src) return null;
    return { kind: "u32", data: new Uint32Array(src.subarray(0, n)) };
  }
  return null;
}

function writeFrozen(atoms: Block, column: string, frozen: Frozen): void {
  if (frozen.kind === "f64") atoms.setColF(column, frozen.data);
  else if (frozen.kind === "str") atoms.setColStr(column, frozen.data);
  else if (frozen.kind === "i32") atoms.setColI32(column, frozen.data);
  else atoms.setColU32(column, frozen.data);
}
