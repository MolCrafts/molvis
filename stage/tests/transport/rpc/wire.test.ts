import { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  BUFFER_REF_MARKER,
  type BufferRef,
  decodeBox,
  decodeFrame,
  encodeFrame,
  WireError,
  type WireFrame,
} from "../../../src/transport/rpc/wire";

/** Wrap typed arrays as the transport's DataView buffer list. */
function asBuffers(...arrays: ArrayBufferView[]): DataView[] {
  return arrays.map(
    (a) => new DataView(a.buffer as ArrayBuffer, a.byteOffset, a.byteLength),
  );
}

function ref(index: number): BufferRef {
  return { [BUFFER_REF_MARKER]: true, index };
}

describe("decodeFrame — dtype is declared, never inferred", () => {
  it("keeps integer-valued f64 coordinates as float", () => {
    // The regression this whole contract exists for: whole-number coordinates
    // used to be sniffed as u32 and the atoms vanished from the render.
    const frame = decodeFrame({
      blocks: {
        atoms: {
          columns: {
            x: { dtype: "f64", data: new Float64Array([0, 1, 2]) },
            y: { dtype: "f64", data: new Float64Array([0, 0, 0]) },
            z: { dtype: "f64", data: new Float64Array([0, 0, 0]) },
          },
        },
      },
    });
    const atoms = frame.getBlock("atoms");
    expect(atoms?.dtype("x")).toBe("f64");
    expect(Array.from(atoms?.copyColF("x") ?? [])).toEqual([0, 1, 2]);
    frame.free();
  });

  it("round-trips negative i32 instead of wrapping it to u32", () => {
    const frame = decodeFrame({
      blocks: {
        atoms: {
          columns: {
            charge_sign: { dtype: "i32", data: new Int32Array([-1, 0, 1]) },
          },
        },
      },
    });
    const atoms = frame.getBlock("atoms");
    expect(atoms?.dtype("charge_sign")).toBe("i32");
    expect(Array.from(atoms?.copyColI32("charge_sign") ?? [])).toEqual([
      -1, 0, 1,
    ]);
    frame.free();
  });

  it("keeps an empty string column a string column", () => {
    const frame = decodeFrame({
      blocks: {
        atoms: { columns: { element: { dtype: "string", data: [] } } },
      },
    });
    expect(frame.getBlock("atoms")?.dtype("element")).toBe("string");
    frame.free();
  });

  it("rejects a carrier that disagrees with its dtype tag", () => {
    expect(() =>
      decodeFrame({
        blocks: {
          atoms: { columns: { x: { dtype: "f64", data: [0, 1, 2] } } },
        },
      }),
    ).toThrow(/atoms\.x.*Float64Array.*plain Array/s);
  });

  it("rejects an unknown dtype tag rather than guessing", () => {
    expect(() =>
      decodeFrame({
        blocks: {
          atoms: {
            columns: { x: { dtype: "float64", data: new Float64Array(1) } },
          },
        },
      }),
    ).toThrow(WireError);
  });
});

describe("decodeFrame — names are molrs's, not this layer's", () => {
  it("accepts any block and column name without a whitelist", () => {
    const frame = decodeFrame({
      blocks: {
        // No "atoms" block at all, and a grid — both used to be rejected or
        // silently dropped by the old block-name whitelist.
        grid: {
          columns: { density: { dtype: "f64", data: new Float64Array(8) } },
          shape: [2, 2, 2],
        },
        residues: {
          columns: { res_name: { dtype: "string", data: ["ALA", "GLY"] } },
        },
      },
    });
    expect(frame.blockNames().sort()).toEqual(["grid", "residues"]);
    expect(Array.from(frame.getBlock("grid")?.shape() ?? [])).toEqual([
      2, 2, 2,
    ]);
    frame.free();
  });

  it("does not rename symbol to element", () => {
    // molrs keys.rs defines `symbol` and `element` as distinct fields; the old
    // decoder collapsed one into the other.
    const frame = decodeFrame({
      blocks: {
        atoms: {
          columns: {
            symbol: { dtype: "string", data: ["Fe1", "Fe2"] },
            element: { dtype: "string", data: ["Fe", "Fe"] },
          },
        },
      },
    });
    const atoms = frame.getBlock("atoms");
    expect(atoms?.keys().map(String).sort()).toEqual(["element", "symbol"]);
    frame.free();
  });

  it("does not accept i/j as an alias for atomi/atomj", () => {
    // Naming is the producer's contract with molrs, and this layer never
    // rewrites a column. So `i`/`j` stay `i`/`j` — and a block molrs specs as
    // `bonds` is then judged to be missing its required endpoints. The
    // rejection *is* the evidence that no aliasing happened.
    expect(() =>
      decodeFrame({
        blocks: {
          bonds: {
            columns: {
              i: { dtype: "u32", data: new Uint32Array([0]) },
              j: { dtype: "u32", data: new Uint32Array([1]) },
            },
          },
        },
      }),
    ).toThrow(/bonds\.atomi: required column is absent/);
  });

  it("passes column names through untouched on an unspecced block", () => {
    // Same non-rewriting rule, observed where no BlockSpec constrains the
    // names: the block set stays open, so `i`/`j` survive verbatim.
    const frame = decodeFrame({
      blocks: {
        contacts: {
          columns: {
            i: { dtype: "u32", data: new Uint32Array([0]) },
            j: { dtype: "u32", data: new Uint32Array([1]) },
          },
        },
      },
    });
    expect(frame.getBlock("contacts")?.keys().map(String).sort()).toEqual([
      "i",
      "j",
    ]);
    frame.free();
  });
});

describe("decodeFrame — the checks that do remain", () => {
  it("re-labels molrs's row-count rejection with the block.column path", () => {
    // The invariant is molrs's; this layer only says where it was violated.
    expect(() =>
      decodeFrame({
        blocks: {
          atoms: {
            columns: {
              x: { dtype: "f64", data: new Float64Array([0, 1]) },
              element: { dtype: "string", data: ["C"] },
            },
          },
        },
      }),
    ).toThrow(/atoms\.element: .*length 1 but block expects 2/);
  });

  it("rejects a dangling buffer reference", () => {
    expect(() =>
      decodeFrame(
        {
          blocks: { atoms: { columns: { x: { dtype: "f64", data: ref(3) } } } },
        },
        asBuffers(new Float64Array([1])),
      ),
    ).toThrow(/atoms\.x: buffer index 3 is out of range/);
  });

  it("rejects a buffer that is not a whole number of values", () => {
    expect(() =>
      decodeFrame(
        {
          blocks: { atoms: { columns: { x: { dtype: "f64", data: ref(0) } } } },
        },
        asBuffers(new Uint8Array([1, 2, 3])),
      ),
    ).toThrow(/not a whole number of f64 values/);
  });
});

describe("decodeFrame — binary buffers", () => {
  it("interprets bytes with the constructor the dtype tag names", () => {
    const frame = decodeFrame(
      {
        blocks: {
          atoms: {
            columns: {
              x: { dtype: "f64", data: ref(0) },
              id: { dtype: "u32", data: ref(1) },
            },
          },
        },
      },
      asBuffers(new Float64Array([1.5, 2.5]), new Uint32Array([7, 8])),
    );
    const atoms = frame.getBlock("atoms");
    expect(Array.from(atoms?.copyColF("x") ?? [])).toEqual([1.5, 2.5]);
    expect(Array.from(atoms?.copyColU32("id") ?? [])).toEqual([7, 8]);
    frame.free();
  });

  it("copies when the transport hands over an unaligned view", () => {
    // 4-byte offset into a byte buffer: not f64-aligned, so a direct view throws.
    const bytes = new Uint8Array(4 + 16);
    new Float64Array(bytes.buffer, 8, 1)[0] = 42; // aligned write we can find later
    const view = new DataView(bytes.buffer, 4, 16);
    const frame = decodeFrame(
      { blocks: { atoms: { columns: { x: { dtype: "f64", data: ref(0) } } } } },
      [view],
    );
    expect(frame.getBlock("atoms")?.copyColF("x").length).toBe(2);
    frame.free();
  });
});

describe("decodeBox", () => {
  it("reads h row-major with lattice vectors in the columns", () => {
    // Ground truth from molpy for this triclinic cell:
    //   Box.matrix = [[10, 1, 2], [0, 20, 3], [0, 0, 30]]  (columns = a, b, c)
    //   lengths    = [10, 20.024984…, 30.215889…]
    //   tilts      = [1, 2, 3]
    // Row-major flatten of that matrix is what the wire carries.
    const box = decodeBox({
      h: new Float64Array([10, 1, 2, 0, 20, 3, 0, 0, 30]),
      origin: new Float64Array([0, 0, 0]),
      pbc: [true, true, true],
    });
    const lengths = Array.from(box.lengths().toCopy());
    expect(lengths[0]).toBeCloseTo(10, 9);
    expect(lengths[1]).toBeCloseTo(20.024984394500787, 9);
    expect(lengths[2]).toBeCloseTo(30.215889859476256, 9);
    expect(Array.from(box.tilts().toCopy())).toEqual([1, 2, 3]);
  });

  it("rejects a 3x3 sent as nested arrays instead of a flat Float64Array", () => {
    expect(() =>
      decodeBox({
        h: [
          [10, 0, 0],
          [0, 10, 0],
          [0, 0, 10],
        ],
        origin: new Float64Array(3),
        pbc: [true, true, true],
      }),
    ).toThrow(/box\.h/);
  });

  it("requires pbc to be stated, not defaulted", () => {
    expect(() =>
      decodeBox({ h: new Float64Array(9), origin: new Float64Array(3) }),
    ).toThrow(/box\.pbc: must be three booleans/);
  });
});

describe("encodeFrame", () => {
  it("emits every block and column, not a fixed whitelist", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.setColF("x", new Float64Array([0, 1]));
    atoms.setColF("charge", new Float64Array([-0.5, 0.5]));
    atoms.setColStr("element", ["C", "O"]);
    atoms.setColU32("mol_id", new Uint32Array([1, 1]));
    const bonds = frame.createBlock("bonds");
    bonds.setColU32("atomi", new Uint32Array([0]));
    bonds.setColU32("atomj", new Uint32Array([1]));

    const { frame: wire } = encodeFrame(frame);
    expect(Object.keys(wire.blocks).sort()).toEqual(["atoms", "bonds"]);
    expect(Object.keys(wire.blocks.atoms.columns).sort()).toEqual([
      "charge",
      "element",
      "mol_id",
      "x",
    ]);
    expect(wire.blocks.atoms.columns.charge.dtype).toBe("f64");
    expect(wire.blocks.atoms.columns.mol_id.dtype).toBe("u32");
    expect(wire.blocks.atoms.columns.element).toEqual({
      dtype: "string",
      data: ["C", "O"],
    });
    frame.free();
  });

  it("round-trips through decode without loss", () => {
    const original = new Frame();
    const atoms = original.createBlock("atoms");
    atoms.setColF("x", new Float64Array([1.25, -2.5]));
    atoms.setColI32("delta", new Int32Array([-3, 4]));
    atoms.setColStr("element", ["N", "H"]);
    original.box = new Box(
      new Float64Array([10, 1, 2, 0, 20, 3, 0, 0, 30]),
      new Float64Array([0, 0, 0]),
      true,
      true,
      false,
    );
    original.setMetaScalar("energy", -12.5);

    const { frame: wire, buffers } = encodeFrame(original);
    const views = buffers.map((b) => new DataView(b));
    const restored = decodeFrame(wire as unknown as WireFrame, views);

    const restoredAtoms = restored.getBlock("atoms");
    expect(Array.from(restoredAtoms?.copyColF("x") ?? [])).toEqual([
      1.25, -2.5,
    ]);
    expect(Array.from(restoredAtoms?.copyColI32("delta") ?? [])).toEqual([
      -3, 4,
    ]);
    expect(restoredAtoms?.copyColStr("element").map(String)).toEqual([
      "N",
      "H",
    ]);
    // Same cell in, same cell out — the encode-side transpose to row-major and
    // the decode-side read cancel exactly.
    expect(Array.from(restored.box?.lengths().toCopy() ?? [])[1]).toBeCloseTo(
      20.024984394500787,
      9,
    );
    expect(Array.from(restored.box?.tilts().toCopy() ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(restored.box?.pbc() ?? []).map(Boolean)).toEqual([
      true,
      true,
      false,
    ]);
    expect(restored.getMetaScalar("energy")).toBeCloseTo(-12.5, 10);

    original.free();
    restored.free();
  });

  it("carries a grid block's shape", () => {
    const frame = new Frame();
    const grid = frame.createBlock("grid");
    grid.setColF("density", new Float64Array(8));
    grid.setShape(new Uint32Array([2, 2, 2]));

    const { frame: wire } = encodeFrame(frame);
    expect(wire.blocks.grid.shape).toEqual([2, 2, 2]);
    // A flat table carries no shape — its row count is already in the columns.
    frame.free();
  });
});
