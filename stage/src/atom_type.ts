/**
 * Per-atom type keys for palette assignment and Select Type.
 *
 * molrs splits the quantity: `type` is the force-field label (string);
 * `type_id` is the LAMMPS ordinal (uint). Data/dump readers write the
 * ordinal as `type_id`. A numeric `type` column is not a valid spelling.
 */
import { TYPE, TYPE_ID } from "@molcrafts/molvis-core/keys";
import type { Column } from "@molcrafts/molvis-core/molrs";
import { DType } from "./utils/dtype";

/** Read side needed to resolve type keys — molrs `Block` satisfies this. */
export interface AtomTypeSource {
  has(name: string): boolean;
  dtype(name: string): string;
  copy(name: string): Column;
}

/**
 * One string key per atom, or `undefined` when the frame has neither
 * `type` nor `type_id`. Prefer the label (`type`); otherwise stringify
 * `type_id`. A present column of the wrong dtype is an error.
 */
export function readAtomTypeKeys(atoms: AtomTypeSource): string[] | undefined {
  if (atoms.has(TYPE)) {
    const dtype = atoms.dtype(TYPE);
    if (dtype !== DType.String) {
      throw new Error(`column '${TYPE}' must be string, got '${dtype}'`);
    }
    return Array.from(atoms.copy(TYPE) as string[]);
  }
  if (atoms.has(TYPE_ID)) {
    const dtype = atoms.dtype(TYPE_ID);
    if (dtype !== DType.Uint) {
      throw new Error(`column '${TYPE_ID}' must be uint, got '${dtype}'`);
    }
    return Array.from(atoms.copy(TYPE_ID) as BigUint64Array, String);
  }
  return undefined;
}
