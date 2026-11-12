import type { Column } from "@molcrafts/molvis-core/molrs";
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
// dtype vocabulary = molrs's dtype names ("f64" / "i32" / "u64" /
// "string", molrs.d.ts `DType`), NOT a numeric enum.
//
// Where the fakes are deliberately STRICTER than molrs's Block: `copy` hands
// back the fake's own storage instead of a fresh copy. The protocol declares
// it as a read path, so the carrier must never write through it; with a
// copy-returning fake the immutability case below could not fail at all.
//
// Assertions on float columns are EXACT: nothing here does arithmetic, the
// values only move between JS typed arrays, so a tolerance would only serve to
// hide a dtype-narrowing bug (f64 payload copied through an f32 buffer).

type FakeColumn = {
  readonly dtype: string;
  readonly data: Exclude<Column, { real: unknown }>;
  readonly shape?: number[];
};

/** Plain-JS snapshot of a source, used to prove the source was never written. */
interface SourceSnapshot {
  readonly [key: string]: readonly (number | string | bigint | boolean)[];
}

class FakeColumnSource implements ColumnSource {
  constructor(
    private readonly rows: number,
    private readonly columns: ReadonlyArray<readonly [string, FakeColumn]>,
  ) {}

  keys(): string[] {
    return this.columns.map(([key]) => key);
  }

  get nRows(): number {
    return this.rows;
  }

  dtype(key: string): string {
    return this.column(key).dtype;
  }

  copy(key: string): Column {
    return this.column(key).data;
  }
  shape(key: string): number[] {
    return this.column(key).shape ?? [this.rows];
  }

  /** Owned, comparable copy of every column's current contents. */
  snapshot(): SourceSnapshot {
    const out: Record<string, readonly (number | string | bigint | boolean)[]> =
      {};
    for (const [key, column] of this.columns) {
      out[key] = Array.isArray(column.data)
        ? [...column.data]
        : Array.from(column.data as ArrayLike<number | bigint | boolean>);
    }
    return out;
  }

  private column(key: string): FakeColumn {
    const column = this.columns.find(([name]) => name === key)?.[1];
    if (!column) throw new Error(`column "${key}" not found`);
    return column;
  }
}

class FakeColumnSink implements ColumnSink {
  readonly written: string[] = [];
  readonly columns = new Map<string, Column>();
  readonly shapes = new Map<string, number[] | undefined>();
  set(key: string, data: Column, shape?: number[]): void {
    this.written.push(key);
    this.columns.set(key, data);
    this.shapes.set(key, shape);
  }
  floats(key: string): number[] | undefined {
    const c = this.columns.get(key) as Float64Array | undefined;
    return c && Array.from(c);
  }
  strings(key: string): string[] | undefined {
    return this.columns.get(key) as string[] | undefined;
  }
  u32s(key: string): number[] | undefined {
    const c = this.columns.get(key) as BigUint64Array | undefined;
    return c && Array.from(c, Number);
  }
  i32s(key: string): number[] | undefined {
    const c = this.columns.get(key) as Int32Array | undefined;
    return c && Array.from(c);
  }
}

/** Water: one f64, one u32, one string and one i32 column over 3 rows. */
function waterSource(): FakeColumnSource {
  return new FakeColumnSource(3, [
    ["charge", { dtype: "f64", data: Float64Array.of(-0.834, 0.417, 0.417) }],
    ["mol_id", { dtype: "u64", data: BigUint64Array.of(1n, 1n, 1n) }],
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
    ["mol_id", { dtype: "u64", data: BigUint64Array.of(10n, 11n, 12n, 13n) }],
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

    it("pads rows beyond nRows with 0 / empty string (added hydrogen)", () => {
      const source = waterSource();
      const sink = new FakeColumnSink();

      // rows = nRows + 1: the optimizer capped a valence with an explicit H,
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

    it("preserves bool/u32 and gathers every component of a shaped row", () => {
      const source = new FakeColumnSource(2, [
        ["flags", { dtype: "u32", data: Uint32Array.of(7, 8) }],
        ["occupied", { dtype: "bool", data: [true, false] }],
        [
          "velocity",
          {
            dtype: "f64",
            data: Float64Array.of(1, 2, 3, 4, 5, 6),
            shape: [2, 3],
          },
        ],
      ]);
      const sink = new FakeColumnSink();
      new AtomColumnCarrier(source).copyInto(
        sink,
        3,
        (row) => [1, undefined, 0][row],
      );
      expect(sink.columns.get("flags")).toEqual(Uint32Array.of(8, 0, 7));
      expect(sink.columns.get("occupied")).toEqual([false, false, true]);
      expect(sink.floats("velocity")).toEqual([4, 5, 6, 0, 0, 0, 1, 2, 3]);
      expect(sink.shapes.get("velocity")).toEqual([3, 3]);
    });
    it("rejects unsupported dtypes rather than silently dropping them", () => {
      const source = new FakeColumnSource(1, [
        ["future", { dtype: "future", data: Uint8Array.of(1) }],
      ]);
      expect(() =>
        new AtomColumnCarrier(source).copyInto(
          new FakeColumnSink(),
          1,
          (row) => row,
        ),
      ).toThrow(/future/);
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
        mol_id: [1n, 1n, 1n],
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
