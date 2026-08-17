import type { Frame } from "@molcrafts/molvis-core/molrs";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { SelectionMask } from "../pipeline/types";
import { DType } from "../utils/dtype";

/**
 * OVITO-style **Select Type**: select atoms by `element` and/or type
 * column membership. Empty `elements` and `types` selects nothing
 * (does not select-all). Matching is case-sensitive for element strings;
 * a numeric `type_id` ordinal is stringified so both spellings compare
 * against the same `types` list.
 *
 * Does not reimplement the expression evaluator — a dedicated multi-select
 * API for hard-coded unit tests and a future property panel.
 */
export class SelectTypeModifier extends BaseModifier {
  static readonly NAME = "Select Type";

  private _elements: string[] = [];
  private _types: string[] = [];

  constructor(id = "select-type-default") {
    super(
      id,
      SelectTypeModifier.NAME,
      new Set([ModifierCapability.ProducesSelection]),
    );
  }

  get elements(): readonly string[] {
    return this._elements;
  }

  set elements(value: readonly string[]) {
    this._elements = [...value];
  }

  get types(): readonly string[] {
    return this._types;
  }

  set types(value: readonly string[]) {
    this._types = [...value];
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._elements.join(",")}:${this._types.join(",")}`;
  }

  apply(input: Frame, context: PipelineContext): Frame {
    const atoms = input.getBlock("atoms");
    if (!atoms) {
      context.currentSelection = SelectionMask.none(0);
      context.selectionSet.set(this.id, context.currentSelection);
      return input;
    }

    const n = atoms.nrows();
    if (this._elements.length === 0 && this._types.length === 0) {
      const empty = SelectionMask.none(n);
      context.currentSelection = empty;
      context.selectionSet.set(this.id, empty);
      return input;
    }

    const elementSet =
      this._elements.length > 0 ? new Set(this._elements) : null;
    const typeSet = this._types.length > 0 ? new Set(this._types) : null;

    const elements =
      elementSet && atoms.dtype("element")
        ? (atoms.copyColStr("element") as string[])
        : null;
    const typeStrings = typeSet ? readTypeColumnAsStrings(atoms, n) : null;

    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      let hit = false;
      if (elementSet && elements && elementSet.has(elements[i])) hit = true;
      if (!hit && typeSet && typeStrings && typeSet.has(typeStrings[i])) {
        hit = true;
      }
      if (hit) indices.push(i);
    }

    const mask = SelectionMask.fromIndices(n, indices);
    context.currentSelection = mask;
    context.selectionSet.set(this.id, mask);
    return input;
  }
}

/**
 * Read the atoms' type as strings. Missing → `""`.
 *
 * The schema splits the quantity in two: `type` is always a String (a
 * force-field label, "what survives a round trip through a force field") and
 * `type_id` is always a UInt (a LAMMPS ordinal). Reading a numeric `type`
 * used to be the path for LAMMPS frames, but molrs rejects that column
 * outright now — so the ordinal is read from `type_id` and stringified,
 * letting one `types` list match either spelling.
 */
function readTypeColumnAsStrings(
  atoms: {
    dtype: (name: string) => string | undefined;
    copyColStr: (name: string) => string[] | undefined;
    viewColU32: (name: string) => Uint32Array | undefined;
  },
  n: number,
): string[] {
  const blank = () => Array.from({ length: n }, () => "");

  if (atoms.dtype("type") === DType.String) {
    const src = atoms.copyColStr("type") as string[] | undefined;
    if (src) return src.map((v) => String(v));
  }
  if (atoms.dtype("type_id") === DType.U32) {
    const src = atoms.viewColU32("type_id");
    if (src) return Array.from(src, (v) => String(v));
  }
  return blank();
}
