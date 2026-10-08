/**
 * Column dtype constants matching molrs `Block.dtype()` return values.
 * Use everywhere we compare against dtype strings so a typo becomes a
 * type error instead of a silent no-op.
 */
export const DType = {
  /** Float column, `Float64Array` (molrs `f64`). */
  Float: "float",
  /** Signed integer column, `Int32Array` (molrs `i32`). */
  Int: "int",
  /**
   * Domain uint / Idx (`id`, `mol_id`, `type_id`, `res_id`, bond endpoints,
   * `bond_type`, `bond_number`), `BigUint64Array` (molrs `u64`).
   */
  Uint: "uint",
  /**
   * Storage-width uint32 for columns that arrived as uint32 and were not
   * promoted to Idx. `Uint32Array`; not a domain-uint column.
   */
  U32: "u32",
  String: "string",
} as const;

export type ColumnDType = (typeof DType)[keyof typeof DType];
