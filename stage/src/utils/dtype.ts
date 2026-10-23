/**
 * Column dtype constants matching WASM `Block.dtype()` return values.
 * Use everywhere we compare against dtype strings so a typo becomes a
 * type error instead of a silent no-op.
 */
export const DType = {
  /** molrs `float`: f64 storage, `Float64Array`. */
  F64: "float",
  /** molrs `int`: i32 storage, `Int32Array`. */
  I32: "int",
  /**
   * Domain uint / Idx (`id`, `mol_id`, `type_id`, `res_id`, bond endpoints,
   * `bond_type`, `bond_number`). molrs `Block.dtype()` reports `"uint"`;
   * the buffer is `BigUint64Array` (`copy` / `view`).
   */
  U64: "uint",
  /**
   * Storage-width uint32 for columns that arrived as uint32 and were not
   * promoted to Idx. Not a domain-uint column (`"uint"`).
   */
  U32: "u32",
  String: "string",
} as const;

export type ColumnDType = (typeof DType)[keyof typeof DType];

/**
 * True when `dtype` names a molrs float column.
 *
 * molrs's float columns are the compute scalar `F = f64`. `Block.dtype()`
 * reports that as `"float"`, and `view` / `copy` return `Float64Array`.
 */
export function isFloatColumn(
  dtype: string | undefined,
): dtype is typeof DType.F64 {
  return dtype === DType.F64;
}

/**
 * True when `dtype` names a molrs domain-uint / Idx column (`"uint"`).
 *
 * The buffer is `BigUint64Array`. `"u32"` is a storage-width spelling
 * and is not a domain-uint column.
 */
export function isDomainUintDtype(
  dtype: string | undefined,
): dtype is typeof DType.U64 {
  return dtype === DType.U64;
}

/**
 * Every numeric dtype `Block.dtype()` reports. molrs 0.17 names the three
 * compute widths `float` / `int` / `uint` (f64 / i32 / u64 storage).
 * `formal_charge` stays `i64`. A reader that only knows those three drops
 * the width-specific columns on copy.
 */
const NUMERIC_CTOR = {
  float: Float64Array,
  i8: Int8Array,
  i16: Int16Array,
  int: Int32Array,
  i64: BigInt64Array,
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  uint: BigUint64Array,
} as const;

export type NumericDType = keyof typeof NUMERIC_CTOR;

export type NumericArray = InstanceType<(typeof NUMERIC_CTOR)[NumericDType]>;

export function isNumericDtype(
  dtype: string | undefined,
): dtype is NumericDType {
  return dtype !== undefined && Object.hasOwn(NUMERIC_CTOR, dtype);
}

/** Fresh buffer of `src`'s dtype and length `n` (zeros / `0n`). */
export function allocLike(src: NumericArray, n: number): NumericArray {
  return new (src.constructor as new (length: number) => NumericArray)(n);
}

/** `src` as f64. An f64 column is returned as-is; other widths are widened. */
export function asFloat64(src: NumericArray): Float64Array {
  if (src instanceof Float64Array) return src;
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Number(src[i]);
  return out;
}

/**
 * Pack the rows whose `indexMap` entry is not `-1`, in that order.
 * The result has `src`'s dtype.
 */
export function compactKept(
  src: NumericArray,
  indexMap: ArrayLike<number>,
  outCount: number,
): NumericArray {
  const out = allocLike(src, outCount);
  const dst = out as unknown as Array<number | bigint>;
  const from = src as unknown as ArrayLike<number | bigint>;
  let ptr = 0;
  for (let i = 0; i < indexMap.length; i++) {
    if (indexMap[i] !== -1) dst[ptr++] = from[i];
  }
  return out;
}

/** Repeat the first `rows` of `src`, `images` times, keeping `src`'s dtype. */
export function tileNumeric(
  src: NumericArray,
  rows: number,
  images: number,
): NumericArray {
  const out = allocLike(src, rows * images);
  const piece = src.subarray(0, rows) as NumericArray;
  for (let g = 0; g < images; g++) {
    (out as NumericArray & { set(s: NumericArray, o?: number): void }).set(
      piece,
      g * rows,
    );
  }
  return out;
}

/** `out[i] = src[srcOfDest[i]]`, keeping `src`'s dtype. */
export function permuteNumeric(
  src: NumericArray,
  srcOfDest: ArrayLike<number>,
): NumericArray {
  const out = allocLike(src, srcOfDest.length);
  const dst = out as unknown as Array<number | bigint>;
  const from = src as unknown as ArrayLike<number | bigint>;
  for (let i = 0; i < srcOfDest.length; i++) dst[i] = from[srcOfDest[i]];
  return out;
}

/**
 * Concatenate `parts` (a missing part stays zero) into one buffer of
 * `prototype`'s dtype.
 */
export function concatNumeric(
  prototype: NumericArray,
  parts: readonly (NumericArray | undefined)[],
  counts: readonly number[],
  total: number,
): NumericArray {
  const out = allocLike(prototype, total);
  const dst = out as NumericArray & { set(s: NumericArray, o?: number): void };
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    const src = parts[i];
    if (src) dst.set(src.subarray(0, counts[i]) as NumericArray, offset);
    offset += counts[i];
  }
  return out;
}
