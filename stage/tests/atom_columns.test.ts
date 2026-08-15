import { describe, expect, it } from "@rstest/core";
import {
  AtomColumnCarrier,
  type ColumnSink,
  type ColumnSource,
} from "../src/atom_columns";

// Unit under test: stage/src/atom_columns.ts (spec
// optimize-staging-02-columns). AtomColumnCarrier is the single column copier
// shared by the commit path (scene_sync.materializeFrameFromScene) and the
// optimize round trip (optimize/structure.ts, whose private
// cloneAtomColumns this replaced).
//
// Every collaborator here is a PURE OBJECT: ColumnSource / ColumnSink are
// declared as structural protocols precisely so this file never touches molrs.
// No WASM Block, no Frame, no allocation to free.
//
// dtype vocabulary = molrs's dtype strings ("f32" / "f64" / "i32" / "u32" /
// "string", molrs.d.ts:201), NOT a numeric enum.
//
// Two places where the fakes are deliberately STRICTER than molrs's Block:
//
//  1. `copyCol*` hands back the fake's own storage instead of a fresh copy.
//     The protocol declares those methods as read paths, so the carrier must
//     never write through them; with a copy-returning fake the immutability
//     case below could not fail at all.
//  2. `copyCol*` throws when the requested reader does not match the column's
//     dtype, mirroring molrs ("Throws if the column ... is not of the active
//     float type"). A carrier that calls a reader before dispatching on
//     `dtype()` therefore blows up instead of silently skipping.
//
// Assertions on float columns are EXACT: nothing here does arithmetic, the
// values only move between JS typed arrays, so a tolerance would only serve to
// hide a dtype-narrowing bug (f64 payload copied through an f32 buffer).

type FakeColumn =
  | { readonly dtype: "f64"; readonly data: Float64Array }
  | { readonly dtype: "f32"; readonly data: Float32Array }
  | { readonly dtype: "u32"; readonly data: Uint32Array }
  | { readonly dtype: "i32"; readonly data: Int32Array }
  | { readonly dtype: "string"; readonly data: string[] }
  // Not part of the dtype vocabulary — stands in for a column type the
  // carrier has no reader for (molrs grows dtypes independently of stage).
  | { readonly dtype: "bool"; readonly data: Uint8Array };

/** Plain-JS snapshot of a source, used to prove the source was never written. */
interface SourceSnapshot {
  readonly [key: string]: readonly (number | string)[];
}

class FakeColumnSource implements ColumnSource {
  constructor(
    private readonly rows: number,
    private readonly columns: ReadonlyArray<readonly [string, FakeColumn]>,
  ) {}

  keys(): string[] {
    return this.columns.map(([key]) => key);
  }

  nrows(): number {
    return this.rows;
  }

  dtype(key: string): string | undefined {
    return this.column(key)?.dtype;
  }

  copyColF(key: string): Float64Array | Float32Array | undefined {
    const column = this.column(key);
    if (!column) return undefined;
    if (column.dtype !== "f64" && column.dtype !== "f32") {
      throw new Error(`column "${key}" is ${column.dtype}, not a float column`);
    }
    return column.data;
  }

  copyColStr(key: string): string[] | undefined {
    const column = this.column(key);
    if (!column) return undefined;
    if (column.dtype !== "string") {
      throw new Error(
        `column "${key}" is ${column.dtype}, not a string column`,
      );
    }
    return column.data;
  }

  copyColU32(key: string): Uint32Array | undefined {
    const column = this.column(key);
    if (!column) return undefined;
    if (column.dtype !== "u32") {
      throw new Error(`column "${key}" is ${column.dtype}, not a u32 column`);
    }
    return column.data;
  }

  copyColI32(key: string): Int32Array | undefined {
    const column = this.column(key);
    if (!column) return undefined;
    if (column.dtype !== "i32") {
      throw new Error(`column "${key}" is ${column.dtype}, not an i32 column`);
    }
    return column.data;
  }

  /** Owned, comparable copy of every column's current contents. */
  snapshot(): SourceSnapshot {
    const out: Record<string, readonly (number | string)[]> = {};
    for (const [key, column] of this.columns) {
      out[key] =
        column.dtype === "string" ? [...column.data] : Array.from(column.data);
    }
    return out;
  }

  private column(key: string): FakeColumn | undefined {
    return this.columns.find(([name]) => name === key)?.[1];
  }
}

class FakeColumnSink implements ColumnSink {
  readonly written: string[] = [];
  private readonly floatCols = new Map<string, Float64Array>();
  private readonly stringCols = new Map<string, string[]>();
  private readonly u32Cols = new Map<string, Uint32Array>();
  private readonly i32Cols = new Map<string, Int32Array>();

  setColF(key: string, value: Float64Array): void {
    this.written.push(key);
    this.floatCols.set(key, value);
  }

  setColStr(key: string, value: string[]): void {
    this.written.push(key);
    this.stringCols.set(key, value);
  }

  setColU32(key: string, value: Uint32Array): void {
    this.written.push(key);
    this.u32Cols.set(key, value);
  }

  setColI32(key: string, value: Int32Array): void {
    this.written.push(key);
    this.i32Cols.set(key, value);
  }

  floats(key: string): number[] | undefined {
    const column = this.floatCols.get(key);
    return column ? Array.from(column) : undefined;
  }

  strings(key: string): string[] | undefined {
    const column = this.stringCols.get(key);
    return column ? [...column] : undefined;
  }

  u32s(key: string): number[] | undefined {
    const column = this.u32Cols.get(key);
    return column ? Array.from(column) : undefined;
  }

  i32s(key: string): number[] | undefined {
    const column = this.i32Cols.get(key);
    return column ? Array.from(column) : undefined;
  }
}

/** Water: one f64, one u32, one string and one i32 column over 3 rows. */
function waterSource(): FakeColumnSource {
  return new FakeColumnSource(3, [
    ["charge", { dtype: "f64", data: Float64Array.of(-0.834, 0.417, 0.417) }],
    ["mol_id", { dtype: "u32", data: Uint32Array.of(1, 1, 1) }],
    ["res_name", { dtype: "string", data: ["HOH", "HOH", "HOH"] }],
    ["type_id", { dtype: "i32", data: Int32Array.of(7, 8, 8) }],
  ]);
}

/** Four rows, every row distinguishable in every column (cross-talk probe). */
function fourRowSource(): FakeColumnSource {
  return new FakeColumnSource(4, [
    [
      "charge",
      { dtype: "f64", data: Float64Array.of(-0.834, 0.417, -0.7, 0.3) },
    ],
    ["mol_id", { dtype: "u32", data: Uint32Array.of(10, 11, 12, 13) }],
    ["res_name", { dtype: "string", data: ["HOH", "HOH", "MET", "MET"] }],
    ["type_id", { dtype: "i32", data: Int32Array.of(1, 2, 3, 4) }],
  ]);
}

describe("TestAtomColumnCarrier", () => {
  describe("copyInto", () => {
    it("copies every dtype value-for-value under an identity mapping", () => {
      const source = waterSource();
      const sink = new FakeColumnSink();

      new AtomColumnCarrier(source).copyInto(sink, 3, (row: number) => row);

      expect(sink.floats("charge")).toEqual([-0.834, 0.417, 0.417]);
      expect(sink.u32s("mol_id")).toEqual([1, 1, 1]);
      expect(sink.strings("res_name")).toEqual(["HOH", "HOH", "HOH"]);
      expect(sink.i32s("type_id")).toEqual([7, 8, 8]);
    });

    it("pads rows beyond nrows with 0 / empty string (added hydrogen)", () => {
      const source = waterSource();
      const sink = new FakeColumnSink();

      // rows = nrows + 1: the optimizer capped a valence with an explicit H,
      // which has no source row at all.
      new AtomColumnCarrier(source).copyInto(sink, 4, (row: number) =>
        row < 3 ? row : undefined,
      );

      expect(sink.floats("charge")).toEqual([-0.834, 0.417, 0.417, 0]);
      expect(sink.u32s("mol_id")).toEqual([1, 1, 1, 0]);
      expect(sink.strings("res_name")).toEqual(["HOH", "HOH", "HOH", ""]);
      expect(sink.i32s("type_id")).toEqual([7, 8, 8, 0]);
    });

    it("zeroes a mid-range unmapped row without disturbing its neighbours", () => {
      const source = waterSource();
      const sink = new FakeColumnSink();

      new AtomColumnCarrier(source).copyInto(sink, 3, (row: number) =>
        row === 1 ? undefined : row,
      );

      expect(sink.floats("charge")).toEqual([-0.834, 0, 0.417]);
      expect(sink.u32s("mol_id")).toEqual([1, 0, 1]);
      expect(sink.strings("res_name")).toEqual(["HOH", "", "HOH"]);
      expect(sink.i32s("type_id")).toEqual([7, 0, 8]);
    });

    it("follows a sparse mapping without cross-talk between rows", () => {
      const source = fourRowSource();
      const sink = new FakeColumnSink();
      // Source row 1 was deleted on canvas: dense rows 0,1,2 ← source 0,2,3.
      const sourceRows = [0, 2, 3];

      new AtomColumnCarrier(source).copyInto(
        sink,
        3,
        (row: number) => sourceRows[row],
      );

      expect(sink.floats("charge")).toEqual([-0.834, -0.7, 0.3]);
      expect(sink.u32s("mol_id")).toEqual([10, 12, 13]);
      expect(sink.strings("res_name")).toEqual(["HOH", "MET", "MET"]);
      expect(sink.i32s("type_id")).toEqual([1, 3, 4]);
    });

    it("skips a column whose dtype it has no reader for, without throwing", () => {
      const source = new FakeColumnSource(3, [
        [
          "charge",
          { dtype: "f64", data: Float64Array.of(-0.834, 0.417, 0.417) },
        ],
        ["occupied", { dtype: "bool", data: Uint8Array.of(1, 0, 1) }],
        ["res_name", { dtype: "string", data: ["HOH", "HOH", "HOH"] }],
      ]);
      const sink = new FakeColumnSink();

      expect(() =>
        new AtomColumnCarrier(source).copyInto(sink, 3, (row: number) => row),
      ).not.toThrow();

      expect(sink.written).not.toContain("occupied");
      // The unknown column must not abort the columns around it either.
      expect(sink.floats("charge")).toEqual([-0.834, 0.417, 0.417]);
      expect(sink.strings("res_name")).toEqual(["HOH", "HOH", "HOH"]);
    });

    it("never writes into the source (immutability)", () => {
      const source = waterSource();
      const before = source.snapshot();
      const sink = new FakeColumnSink();

      // Padding + a hole is the mapping most likely to tempt an in-place
      // rewrite of the source arrays.
      new AtomColumnCarrier(source).copyInto(sink, 4, (row: number) =>
        row === 1 ? undefined : row < 3 ? row : undefined,
      );

      expect(source.snapshot()).toEqual(before);
      expect(before).toEqual({
        charge: [-0.834, 0.417, 0.417],
        mol_id: [1, 1, 1],
        res_name: ["HOH", "HOH", "HOH"],
        type_id: [7, 8, 8],
      });
    });

    it("copies x/y/z/element like any other column (no special-casing)", () => {
      // The carrier owns no column names: the CALLER overwrites the columns it
      // owns after copyInto returns (structure.ts's existing order). Anything
      // the carrier skipped by name would be silently unrecoverable here.
      const source = new FakeColumnSource(3, [
        ["x", { dtype: "f64", data: Float64Array.of(0, 0.96, -0.24) }],
        ["y", { dtype: "f64", data: Float64Array.of(0, 0, 0.93) }],
        ["z", { dtype: "f64", data: Float64Array.of(0, 0, 0) }],
        ["element", { dtype: "string", data: ["O", "H", "H"] }],
        [
          "charge",
          { dtype: "f64", data: Float64Array.of(-0.834, 0.417, 0.417) },
        ],
      ]);
      const sink = new FakeColumnSink();

      new AtomColumnCarrier(source).copyInto(sink, 3, (row: number) => row);

      expect(sink.floats("x")).toEqual([0, 0.96, -0.24]);
      expect(sink.floats("y")).toEqual([0, 0, 0.93]);
      expect(sink.floats("z")).toEqual([0, 0, 0]);
      expect(sink.strings("element")).toEqual(["O", "H", "H"]);
      expect(sink.floats("charge")).toEqual([-0.834, 0.417, 0.417]);
    });
  });
});
