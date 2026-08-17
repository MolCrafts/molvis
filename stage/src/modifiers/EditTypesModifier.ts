/**
 * OVITO-style **Edit types**: set element and/or type for the current
 * selection.
 */

import { Frame } from "@molcrafts/molvis-core/molrs";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { DType } from "../utils/dtype";

export class EditTypesModifier extends BaseModifier {
  static readonly NAME = "Edit types";

  private _element: string | null = "C";
  private _typeValue: string | null = null;

  constructor(id = "edit-types-default") {
    super(
      id,
      EditTypesModifier.NAME,
      new Set([
        ModifierCapability.ConsumesSelection,
        ModifierCapability.TransformsData,
      ]),
    );
  }

  get element(): string | null {
    return this._element;
  }
  get typeValue(): string | null {
    return this._typeValue;
  }

  setElement(v: string | null): void {
    this._element = v?.trim() ? v.trim() : null;
  }

  setTypeValue(v: string | null): void {
    this._typeValue = v?.trim() ? v.trim() : null;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._element ?? ""}:${this._typeValue ?? ""}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    if (!this._element && !this._typeValue) return input;
    const indices = context.currentSelection.getIndices();
    if (indices.length === 0) return input;

    const atoms = input.getBlock("atoms");
    if (!atoms) return input;
    const n = atoms.nrows();

    const result = new Frame();
    result.insertBlock("atoms", atoms);
    const out = result.getBlock("atoms");
    if (!out) return input;

    if (this._element) {
      const els = out.dtype("element")
        ? ([...(out.copyColStr("element") as string[])] as string[])
        : Array.from({ length: n }, () => "X");
      for (const i of indices) {
        if (i >= 0 && i < n) els[i] = this._element;
      }
      out.setColStr("element", els);
    }

    if (this._typeValue) {
      const dtype = out.dtype("type");
      if (dtype === DType.I32 || (!dtype && /^-?\d+$/.test(this._typeValue))) {
        const src =
          dtype === DType.I32 ? out.viewColI32("type") : new Int32Array(n);
        const arr = src ? new Int32Array(src) : new Int32Array(n);
        const tv = Number.parseInt(this._typeValue, 10);
        for (const i of indices) {
          if (i >= 0 && i < n) arr[i] = tv;
        }
        out.setColI32("type", arr);
      } else {
        const src = out.dtype("type")
          ? ([...(out.copyColStr("type") as string[])] as string[])
          : Array.from({ length: n }, () => "");
        for (const i of indices) {
          if (i >= 0 && i < n) src[i] = this._typeValue;
        }
        out.setColStr("type", src);
      }
    }

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
