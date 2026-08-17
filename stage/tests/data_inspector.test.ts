import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import {
  type ColumnDescriptor,
  discoverAtomColumns,
  extractAtomRows,
  extractAtomRowsAt,
  extractAtomSortKeys,
  extractBondColumns,
  extractBondRows,
} from "../src/data_inspector";

function makeAtomBlock(
  elements: string[],
  positions: [number, number, number][],
): Block {
  const block = new Block();
  block.setColStr("element", elements);
  block.setColF("x", new Float64Array(positions.map((p) => p[0])));
  block.setColF("y", new Float64Array(positions.map((p) => p[1])));
  block.setColF("z", new Float64Array(positions.map((p) => p[2])));
  return block;
}

describe("discoverAtomColumns", () => {
  it("should discover element, x, y, z columns", () => {
    const block = makeAtomBlock(
      ["C", "O"],
      [
        [0, 0, 0],
        [1, 1, 1],
      ],
    );
    const cols = discoverAtomColumns(block);
    const names = cols.map((c) => c.name);
    expect(names).toContain("element");
    expect(names).toContain("x");
    expect(names).toContain("y");
    expect(names).toContain("z");
  });

  it("should sort element first, then x/y/z", () => {
    const block = makeAtomBlock(["C"], [[1, 2, 3]]);
    const cols = discoverAtomColumns(block);
    expect(cols[0].name).toBe("element");
    expect(cols[1].name).toBe("x");
    expect(cols[2].name).toBe("y");
    expect(cols[3].name).toBe("z");
  });

  it("should skip internal __ columns", () => {
    const block = makeAtomBlock(["C"], [[0, 0, 0]]);
    block.setColF("__color_r", new Float64Array([1.0]));
    const cols = discoverAtomColumns(block);
    const names = cols.map((c) => c.name);
    expect(names).not.toContain("__color_r");
  });

  it("should include additional columns", () => {
    const block = makeAtomBlock(["C"], [[0, 0, 0]]);
    block.setColF("charge", new Float64Array([0.5]));
    const cols = discoverAtomColumns(block);
    const names = cols.map((c) => c.name);
    expect(names).toContain("charge");
  });
});

describe("extractAtomRows", () => {
  it("should extract all rows with values", () => {
    const block = makeAtomBlock(
      ["C", "O", "N"],
      [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
    );
    const cols = discoverAtomColumns(block);
    const rows = extractAtomRows(block, cols);
    expect(rows.length).toBe(3);
    expect(rows[0].index).toBe(0);
    expect(rows[0].values.get("element")).toBe("C");
    expect(rows[1].values.get("element")).toBe("O");
    expect(rows[2].values.get("element")).toBe("N");
  });

  it("should format numeric values with 3 decimal places", () => {
    const block = makeAtomBlock(["C"], [[1.23456, 0, 0]]);
    const cols = discoverAtomColumns(block);
    const rows = extractAtomRows(block, cols);
    expect(rows[0].values.get("x")).toBe("1.235");
  });

  it("should support start/count pagination", () => {
    const elements = Array.from({ length: 10 }, () => "C");
    const positions = Array.from(
      { length: 10 },
      (_, i) => [i, 0, 0] as [number, number, number],
    );
    const block = makeAtomBlock(elements, positions);
    const cols = discoverAtomColumns(block);
    const rows = extractAtomRows(block, cols, 3, 4);
    expect(rows.length).toBe(4);
    expect(rows[0].index).toBe(3);
    expect(rows[3].index).toBe(6);
  });

  it("should handle empty block", () => {
    const block = new Block();
    const rows = extractAtomRows(block, []);
    expect(rows.length).toBe(0);
  });
});

describe("extractAtomRowsAt", () => {
  it("materializes exactly the requested (non-contiguous) indices in order", () => {
    const elements = ["C", "O", "N", "H", "S"];
    const positions = elements.map(
      (_, i) => [i, 0, 0] as [number, number, number],
    );
    const block = makeAtomBlock(elements, positions);
    const cols = discoverAtomColumns(block);
    const rows = extractAtomRowsAt(block, cols, [4, 0, 2]);
    expect(rows.map((r) => r.index)).toEqual([4, 0, 2]);
    expect(rows.map((r) => r.values.get("element"))).toEqual(["S", "C", "N"]);
  });

  it("silently skips out-of-range indices", () => {
    const block = makeAtomBlock(["C"], [[0, 0, 0]]);
    const cols = discoverAtomColumns(block);
    const rows = extractAtomRowsAt(block, cols, [-1, 0, 5]);
    expect(rows.map((r) => r.index)).toEqual([0]);
  });
});

describe("extractAtomSortKeys", () => {
  it("returns raw numeric keys for float columns (no string formatting)", () => {
    const block = makeAtomBlock(
      ["C", "O"],
      [
        [1.23456, 0, 0],
        [-2.5, 0, 0],
      ],
    );
    const keys = extractAtomSortKeys(block, { name: "x", dtype: "f64" });
    expect(keys?.kind).toBe("numeric");
    if (keys?.kind === "numeric") {
      expect(keys.values[0]).toBeCloseTo(1.23456, 9);
      expect(keys.values[1]).toBeCloseTo(-2.5, 9);
    }
  });

  it("returns string keys for string columns", () => {
    const block = makeAtomBlock(
      ["O", "C"],
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
    );
    const keys = extractAtomSortKeys(block, {
      name: "element",
      dtype: "string",
    });
    expect(keys?.kind).toBe("string");
    if (keys?.kind === "string") {
      expect(keys.values).toEqual(["O", "C"]);
    }
  });

  it("returns null for unknown dtypes", () => {
    const block = makeAtomBlock(["C"], [[0, 0, 0]]);
    expect(
      extractAtomSortKeys(block, { name: "x", dtype: "weird" }),
    ).toBeNull();
  });
});

// ── note topic `dtype-float-dispatch` ───────────────────────────────────────
// molrs picks its float width at COMPILE TIME ("the concrete float dtype string
// for this build", molrs.d.ts:3349), so `Block.dtype()` reports "f32" for the
// very same column on an f32-built molrs artifact (molrs.d.ts:181/:197).
//
// The inspector does NOT re-read `block.dtype()` when it materializes: it
// dispatches on the `ColumnDescriptor.dtype` string that `discoverAtomColumns`
// already handed the caller (data_inspector.ts:78/:110/:178). That descriptor
// is a plain caller-owned string, which is exactly what makes these cases
// testable on today's f64-only molrs build: passing `dtype: "f32"` reproduces
// an f32 build byte-for-byte, because molrs has a SINGLE float reader
// (`viewColF`/`copyColF` — the Block prototype has no f32-specific accessor),
// so the ONLY thing that differs between the two builds is this string.
//
// Charges are chosen exactly representable in binary (0.5 / -0.25 / 0.125) so
// the expectations stay exact: no arithmetic happens on this path, the value
// only crosses from the column into a formatted string, and a tolerance here
// would only mask a narrowing bug.
function makeChargedBlock(): Block {
  const block = makeAtomBlock(
    ["O", "H", "H"],
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
  );
  block.setColF("charge", new Float64Array([0.5, -0.25, 0.125]));
  return block;
}

/** The descriptors an f32-built molrs yields for {@link makeChargedBlock}. */
const F32_COLUMNS: ColumnDescriptor[] = [
  { name: "element", dtype: "string" },
  { name: "charge", dtype: "f32" },
];

describe("data inspector on an f32 molrs build", () => {
  it("lists f32 column values instead of blanking the column", () => {
    // data_inspector.ts:78 (prefetchColumns) skips any dtype that is not
    // exactly "f64", and :110 (materializeRow) then falls through to "—".
    const rows = extractAtomRows(makeChargedBlock(), F32_COLUMNS);
    expect(rows.length).toBe(3);
    expect(rows[0].values.get("charge")).toBe("0.500");
    expect(rows[1].values.get("charge")).toBe("-0.250");
    expect(rows[2].values.get("charge")).toBe("0.125");
  });

  it("keeps the f32 column populated in a virtualized row window", () => {
    // extractAtomRowsAt shares prefetchColumns, so the window path blanks the
    // same column — asserted separately because it is the path the table
    // actually renders through once the atom count grows.
    const rows = extractAtomRowsAt(makeChargedBlock(), F32_COLUMNS, [2, 0]);
    expect(rows.map((r) => r.index)).toEqual([2, 0]);
    expect(rows.map((r) => r.values.get("charge"))).toEqual(["0.125", "0.500"]);
  });

  it("sorts by an f32 column instead of refusing to sort it", () => {
    // data_inspector.ts:178 — the switch has no "f32" arm, so it falls to
    // `default: return null` and the header click silently does nothing.
    const keys = extractAtomSortKeys(makeChargedBlock(), {
      name: "charge",
      dtype: "f32",
    });
    expect(keys?.kind).toBe("numeric");
    if (keys?.kind === "numeric") {
      expect(Array.from(keys.values)).toEqual([0.5, -0.25, 0.125]);
    }
  });

  it("still refuses a genuinely unsupported dtype", () => {
    // Guard against an over-broad fix: widening float dispatch must not turn
    // the switch into an accept-anything path.
    expect(
      extractAtomSortKeys(makeChargedBlock(), {
        name: "charge",
        dtype: "bool",
      }),
    ).toBeNull();
  });
});

describe("extractBondColumns", () => {
  it("copies bond columns as typed arrays", () => {
    const frame = new Frame();
    const atoms = makeAtomBlock(
      ["C", "O", "N"],
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
    );
    frame.insertBlock("atoms", atoms);
    const bonds = new Block();
    bonds.setColU32("atomi", new Uint32Array([0, 1]));
    bonds.setColU32("atomj", new Uint32Array([1, 2]));
    bonds.setColU32("bond_type", new Uint32Array([2, 1]));
    bonds.setColU32("bond_number", new Uint32Array([2, 1]));
    frame.insertBlock("bonds", bonds);

    const cols = extractBondColumns(frame);
    expect(cols?.count).toBe(2);
    expect(Array.from(cols?.i ?? [])).toEqual([0, 1]);
    expect(Array.from(cols?.j ?? [])).toEqual([1, 2]);
    expect(Array.from(cols?.order ?? [])).toEqual([2, 1]);
  });

  it("returns null for a frame without bonds", () => {
    expect(extractBondColumns(new Frame())).toBeNull();
  });
});

describe("extractBondRows", () => {
  it("should extract bond data", () => {
    const frame = new Frame();
    const atoms = makeAtomBlock(
      ["C", "O"],
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
    );
    frame.insertBlock("atoms", atoms);

    const bonds = new Block();
    bonds.setColU32("atomi", new Uint32Array([0]));
    bonds.setColU32("atomj", new Uint32Array([1]));
    bonds.setColU32("bond_type", new Uint32Array([2]));
    bonds.setColU32("bond_number", new Uint32Array([2]));
    frame.insertBlock("bonds", bonds);

    const rows = extractBondRows(frame);
    expect(rows.length).toBe(1);
    expect(rows[0].i).toBe(0);
    expect(rows[0].j).toBe(1);
    expect(rows[0].order).toBe(2);
  });

  it("should return empty for frame without bonds", () => {
    const frame = new Frame();
    const rows = extractBondRows(frame);
    expect(rows.length).toBe(0);
  });

  it("should default order to 1 when column missing", () => {
    const frame = new Frame();
    const atoms = makeAtomBlock(
      ["C", "O"],
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
    );
    frame.insertBlock("atoms", atoms);

    const bonds = new Block();
    bonds.setColU32("atomi", new Uint32Array([0]));
    bonds.setColU32("atomj", new Uint32Array([1]));
    frame.insertBlock("bonds", bonds);

    const rows = extractBondRows(frame);
    expect(rows[0].order).toBe(1);
  });
});
