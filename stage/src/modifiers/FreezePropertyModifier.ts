/**
 * OVITO-style **Freeze property**: snapshot a column on first run and
 * re-apply those values on later frames (index-aligned).
 */

import { type Block, Frame } from "@molcrafts/molvis-core/molrs";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import {
  allocLike,
  DType,
  isNumericDtype,
  type NumericArray,
} from "../utils/dtype";
import { logger } from "../utils/logger";

type Frozen =
  | { kind: "num"; data: NumericArray }
  | { kind: "str"; data: string[] };

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
    if (!input.has("atoms")) return input;
    const atoms = input.get("atoms");
    const n = atoms.nRows;
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
    result.set("atoms", atoms);
    const outAtoms = result.has("atoms") ? result.get("atoms") : undefined;
    if (!outAtoms) return input;
    writeFrozen(outAtoms, this._column, this._frozen);

    if (input.has("bonds")) result.set("bonds", input.get("bonds"));
    for (const name of input.keys()) {
      if (name === "atoms" || name === "bonds") continue;
      result.set(name, input.get(name));
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
  const dtype = atoms.has(column) ? atoms.dtype(column) : undefined;
  if (!dtype) return null;
  if (isNumericDtype(dtype)) {
    const src = atoms.view(column) as NumericArray;
    if (src.length < n) return null;
    const data = allocLike(src, n);
    (data as NumericArray & { set(s: NumericArray, o?: number): void }).set(
      src.subarray(0, n) as NumericArray,
      0,
    );
    return { kind: "num", data };
  }
  if (dtype === DType.String) {
    const src = atoms.copy(column) as string[] | undefined;
    if (!src) return null;
    return { kind: "str", data: [...src] };
  }
  return null;
}

function writeFrozen(atoms: Block, column: string, frozen: Frozen): void {
  atoms.set(column, frozen.data);
}
