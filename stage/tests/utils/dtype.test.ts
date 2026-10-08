import { Block } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { DType } from "../../src/utils/dtype";

/**
 * Unit under test: stage/src/utils/dtype.ts.
 *
 * `DType` is compared against `Block.dtype()` everywhere a column is
 * dispatched on its type, so each constant must be the exact name molrs
 * reports for the typed array that column is stored as. A constant that
 * drifted from molrs would make every such dispatch skip the column silently.
 */
describe("DType", () => {
  it("names a Float64Array column as molrs reports it", () => {
    const block = new Block();
    block.set("x", new Float64Array([1, 2]));
    expect(block.dtype("x")).toBe(DType.Float);
  });

  it("names an Int32Array column as molrs reports it", () => {
    const block = new Block();
    block.set("charge_state", new Int32Array([1, -1]));
    expect(block.dtype("charge_state")).toBe(DType.Int);
  });

  it("names a BigUint64Array (domain uint / Idx) column as molrs reports it", () => {
    const block = new Block();
    block.set("id", new BigUint64Array([0n, 1n]));
    expect(block.dtype("id")).toBe(DType.Uint);
  });

  it("names a Uint32Array (storage-width) column as molrs reports it", () => {
    const block = new Block();
    block.set("flags", new Uint32Array([0, 1]));
    expect(block.dtype("flags")).toBe(DType.U32);
  });

  it("names a string column as molrs reports it", () => {
    const block = new Block();
    block.set("element", ["C", "O"]);
    expect(block.dtype("element")).toBe(DType.String);
  });
});
