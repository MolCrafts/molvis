import { describe, expect, it } from "@rstest/core";
import { DType, isDomainUintDtype, isFloatColumn } from "../../src/utils/dtype";

/**
 * Unit under test: stage/src/utils/dtype.ts (note topic `dtype-float-dispatch`).
 *
 * molrs's float columns are the compute scalar `F = f64`
 * (`molrs/src/op/types.rs`): narrow float input is promoted to `F` when read,
 * so `"float"` is the only float dtype string `Block.dtype()` returns.
 *
 * `isFloatColumn` is that single predicate. It is a pure string test: no molrs,
 * no WASM, no Block — the whole point is that the call sites can stop
 * open-coding `dtype === DType.F64`.
 */
describe("isFloatColumn", () => {
  // ── Basics ──────────────────────────────────────────────────────────────
  it("accepts float — the compute scalar F, the only float", () => {
    expect(isFloatColumn(DType.F64)).toBe(true);
  });

  it("accepts the raw dtype strings, not just the DType constants", () => {
    // Call sites pass `block.dtype(key)` straight through; that is a plain
    // string off the WASM boundary, never the TS constant object.
    expect(isFloatColumn("float")).toBe(true);
  });

  // ── Edge ────────────────────────────────────────────────────────────────
  it("rejects the integer dtypes", () => {
    expect(isFloatColumn(DType.I32)).toBe(false);
    expect(isFloatColumn(DType.U32)).toBe(false);
    expect(isFloatColumn(DType.U64)).toBe(false);
  });

  it("rejects the string dtype", () => {
    expect(isFloatColumn(DType.String)).toBe(false);
  });

  it("rejects undefined — what a has()-guarded caller passes for an absent column", () => {
    expect(isFloatColumn(undefined)).toBe(false);
  });

  it("rejects non-float dtypes, including widths view can read", () => {
    expect(isFloatColumn("bool")).toBe(false);
    expect(isFloatColumn("u8")).toBe(false);
    expect(isFloatColumn("i64")).toBe(false);
    expect(isFloatColumn("")).toBe(false);
  });
});

describe("isDomainUintDtype", () => {
  it("accepts uint — the molrs identity / Idx spelling", () => {
    expect(isDomainUintDtype(DType.U64)).toBe(true);
    expect(isDomainUintDtype("uint")).toBe(true);
  });

  it("rejects storage-width u32 — identity columns are uint", () => {
    expect(isDomainUintDtype(DType.U32)).toBe(false);
    expect(isDomainUintDtype("u32")).toBe(false);
  });

  it("rejects floats, i32, string, and missing columns", () => {
    expect(isDomainUintDtype(DType.F64)).toBe(false);
    expect(isDomainUintDtype(DType.I32)).toBe(false);
    expect(isDomainUintDtype(DType.String)).toBe(false);
    expect(isDomainUintDtype(undefined)).toBe(false);
  });
});
