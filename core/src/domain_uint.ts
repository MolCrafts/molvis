/**
 * molrs identity / schema-uint columns are `Idx = u64` (dtype `uint`).
 *
 * WASM `Block.set` / `copy` / `view` take and return them as
 * `BigUint64Array`. Indexing that array yields `bigint`.
 * GPU meshes, CSR tables, and scene row maps stay `number` / `Uint32Array`
 * — convert at this boundary, never treat a molrs uint column as `Uint32Array`.
 */

/** Domain-uint column buffer (identifiers and relation endpoints). */
export type DomainUintArray = BigUint64Array;

/**
 * Row index or identifier as a JS number.
 *
 * Molecular systems sit well below `Number.MAX_SAFE_INTEGER`. Values that
 * do not are a contract failure, not a silent wrap.
 */
export function toRowIndex(value: bigint | number): number {
  const n = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`row index out of range: ${String(value)}`);
  }
  return n;
}

/** Pack a number/bigint list into the molrs domain-uint column type. */
export function toDomainUint(
  values: ArrayLike<number | bigint>,
): DomainUintArray {
  const out = new BigUint64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    out[i] = typeof v === "bigint" ? v : BigInt(v as number);
  }
  return out;
}
