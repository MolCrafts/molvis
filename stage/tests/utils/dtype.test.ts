import { describe, expect, it } from "@rstest/core";
import { DType, isFloatDtype } from "../../src/utils/dtype";

/**
 * Unit under test: stage/src/utils/dtype.ts (note topic `dtype-float-dispatch`).
 *
 * molrs picks its float width at COMPILE TIME — `WasmArray.dtype()` is
 * documented as "the concrete float dtype string for this build" — so
 * `Block.dtype()` reports `"f32"` OR `"f64"` for the very same logical column
 * depending on how the molrs WASM artifact was built (molrs.d.ts:181/:197).
 * Every float dispatch in stage must therefore accept both; matching only
 * `DType.F64` silently drops the whole column on an f32 build.
 *
 * `isFloatDtype` is that single predicate. It is a pure string test: no molrs,
 * no WASM, no Block — the whole point is that ~25 call sites can stop
 * open-coding `dtype === DType.F64`.
 *
 * The currently published @molcrafts/molrs (0.13.x, f64 build) cannot produce
 * an f32 column at runtime, so this predicate is the ONLY place the f32 half of
 * the contract can be pinned directly. Weakening it re-opens the debt.
 */
describe("isFloatDtype", () => {
  // ── Basics ──────────────────────────────────────────────────────────────
  it("accepts f64 — the float width of the current molrs build", () => {
    expect(isFloatDtype(DType.F64)).toBe(true);
  });

  it("accepts f32 — the float width of an f32-built molrs", () => {
    expect(isFloatDtype(DType.F32)).toBe(true);
  });

  it("accepts the raw dtype strings, not just the DType constants", () => {
    // Call sites pass `block.dtype(key)` straight through; that is a plain
    // string off the WASM boundary, never the TS constant object.
    expect(isFloatDtype("f64")).toBe(true);
    expect(isFloatDtype("f32")).toBe(true);
  });

  // ── Edge ────────────────────────────────────────────────────────────────
  it("rejects the integer dtypes", () => {
    expect(isFloatDtype(DType.I32)).toBe(false);
    expect(isFloatDtype(DType.U32)).toBe(false);
  });

  it("rejects the string dtype", () => {
    expect(isFloatDtype(DType.String)).toBe(false);
  });

  it("rejects undefined — Block.dtype() returns it for a missing column", () => {
    expect(isFloatDtype(undefined)).toBe(false);
  });

  it("rejects dtypes molrs may grow later", () => {
    // molrs also documents "bool" and "u8"; neither is readable via viewColF,
    // so a predicate that let them through would hand callers the wrong reader.
    expect(isFloatDtype("bool")).toBe(false);
    expect(isFloatDtype("u8")).toBe(false);
    expect(isFloatDtype("")).toBe(false);
  });
});
