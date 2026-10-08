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

    if (!input.has("atoms")) return input;
    const atoms = input.get("atoms");
    const n = atoms.nRows;

    const result = new Frame();
    result.set("atoms", atoms);
    const out = result.get("atoms");

    if (this._element) {
      const els = out.has("element")
        ? [...(out.copy("element") as string[])]
        : Array.from({ length: n }, () => "X");
      for (const i of indices) {
        if (i >= 0 && i < n) els[i] = this._element;
      }
      out.set("element", els);
    }

    if (this._typeValue) {
      const dtype = out.has("type") ? out.dtype("type") : undefined;
      if (dtype === DType.Int || (!dtype && /^-?\d+$/.test(this._typeValue))) {
        const src =
          dtype === DType.Int
            ? (out.view("type") as Int32Array)
            : new Int32Array(n);
        const arr = src ? new Int32Array(src) : new Int32Array(n);
        const tv = Number.parseInt(this._typeValue, 10);
        for (const i of indices) {
          if (i >= 0 && i < n) arr[i] = tv;
        }
        out.set("type", arr);
      } else {
        const src = out.has("type")
          ? [...(out.copy("type") as string[])]
          : Array.from({ length: n }, () => "");
        for (const i of indices) {
          if (i >= 0 && i < n) src[i] = this._typeValue;
        }
        out.set("type", src);
      }
    }

    const bonds = input.has("bonds") ? input.get("bonds") : undefined;
    if (bonds) result.set("bonds", bonds);
    for (const name of input.keys()) {
      if (name === "atoms" || name === "bonds") continue;
      const block = input.has(name) ? input.get(name) : undefined;
      if (block) result.set(name, block);
    }
    if (input.box) result.box = input.box;
    return result;
  }
}
