/**
 * Column dtype constants matching WASM `Block.dtype()` return values.
 * Use everywhere we compare against dtype strings so a typo becomes a
 * type error instead of a silent no-op.
 */
export const DType = {
  F64: "f64",
  /**
   * molrs's float columns are `f64` or `f32` depending on how molrs itself was
   * built, and `Block.dtype()` reports whichever it is. Code that dispatches on
   * float columns must accept both — matching only F64 silently skips every
   * float column on an f32 build.
   */
  F32: "f32",
  I32: "i32",
  U32: "u32",
  String: "string",
} as const;

export type ColumnDType = (typeof DType)[keyof typeof DType];

/**
 * True when `dtype` names a molrs float column — `"f64"` or `"f32"`.
 *
 * The float width is a molrs COMPILE-TIME build choice: the artifact we ship
 * today emits `"f64"` for every float column, but `"f32"` is documented API
 * (`molrs.d.ts` `Block.dtype()`) that an f32-compiled molrs would emit. Any
 * float-column dispatch must go through this predicate — matching `DType.F64`
 * alone silently skips every float column (charge included) on an f32 build.
 */
export function isFloatDtype(
  dtype: string | undefined,
): dtype is typeof DType.F64 | typeof DType.F32 {
  return dtype === DType.F64 || dtype === DType.F32;
}
