import { toDomainUint } from "@molcrafts/molvis-core";
import {
  Box,
  Cell,
  Frame,
  readWireFrame,
  writeWireFrame,
} from "@molcrafts/molvis-core/molrs";
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
    const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
    expect(atoms?.dtype("x")).toBe("f64");
    expect(Array.from((atoms?.copy("x") as Float64Array) ?? [])).toEqual([
      0, 1, 2,
    ]);
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
    const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
    expect(atoms?.dtype("charge_sign")).toBe("i32");
    expect(
      Array.from((atoms?.copy("charge_sign") as Int32Array) ?? []),
    ).toEqual([-1, 0, 1]);
    frame.free();
  });

  it("keeps an empty string column a string column", () => {
    const frame = decodeFrame({
      blocks: {
        atoms: { columns: { element: { dtype: "string", data: [] } } },
      },
    });
    expect(frame.get("atoms").dtype("element")).toBe("string");
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
    expect(frame.keys().sort()).toEqual(["grid", "residues"]);
    expect(frame.get("grid").structuralShape).toEqual([2, 2, 2]);
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
    const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
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
    expect(frame.get("contacts").keys().map(String).sort()).toEqual(["i", "j"]);
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
              id: { dtype: "u64", data: ref(1) },
            },
          },
        },
      },
      asBuffers(new Float64Array([1.5, 2.5]), new BigUint64Array([7n, 8n])),
    );
    const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
    expect(Array.from((atoms?.copy("x") as Float64Array) ?? [])).toEqual([
      1.5, 2.5,
    ]);
    expect(
      Array.from((atoms?.copy("id") as BigUint64Array) ?? [], Number),
    ).toEqual([7, 8]);
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
    expect((frame.get("atoms").copy("x") as Float64Array).length).toBe(2);
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
  it("round-trips integer metadata through JSON without precision loss", () => {
    const source = new Frame();
    source.setMeta("timestep", 500n);
    source.setMeta("count", 18446744073709551615n);
    source.setMeta("offset", -9223372036854775808n);
    const encoded = encodeFrame(source);
    const wire = JSON.parse(JSON.stringify(encoded.frame));
    expect(wire.meta.count).toEqual({
      dtype: "u64",
      data: "18446744073709551615",
    });
    const restored = decodeFrame(wire);
    try {
      expect(restored.getMeta("timestep")).toBe(500n);
      expect(restored.getMeta("count")).toBe(18446744073709551615n);
      expect(restored.getMeta("offset")).toBe(-9223372036854775808n);
    } finally {
      source.free();
      restored.free();
    }
  });

  it("rejects malformed or out-of-range tagged integer metadata", () => {
    for (const value of [
      { dtype: "i64", data: "9223372036854775808" },
      { dtype: "u64", data: "18446744073709551616" },
      { dtype: "u64", data: "-1" },
      { dtype: "i64", data: "1.5" },
      { dtype: "i64", data: "0x10" },
      { dtype: "i64", data: 42 },
      { dtype: "other", data: "42" },
    ]) {
      expect(() => decodeFrame({ blocks: {}, meta: { step: value } })).toThrow(
        /meta.step/,
      );
    }
  });
  it("emits every block and column, not a fixed whitelist", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.set("x", new Float64Array([0, 1]));
    atoms.set("charge", new Float64Array([-0.5, 0.5]));
    atoms.set("element", ["C", "O"]);
    atoms.set("mol_id", toDomainUint([1, 1]));
    const bonds = frame.createBlock("bonds");
    bonds.set("atomi", toDomainUint([0]));
    bonds.set("atomj", toDomainUint([1]));

    const { frame: wire } = encodeFrame(frame);
    expect(Object.keys(wire.blocks).sort()).toEqual(["atoms", "bonds"]);
    expect(Object.keys(wire.blocks.atoms.columns).sort()).toEqual([
      "charge",
      "element",
      "mol_id",
      "x",
    ]);
    expect(wire.blocks.atoms.columns.charge.dtype).toBe("f64");
    expect(wire.blocks.atoms.columns.mol_id.dtype).toBe("u64");
    expect(wire.blocks.atoms.columns.element).toEqual({
      dtype: "string",
      data: ["C", "O"],
      shape: [2],
    });
    frame.free();
  });

  it("round-trips through decode without loss", () => {
    const original = new Frame();
    const atoms = original.createBlock("atoms");
    atoms.set("x", new Float64Array([1.25, -2.5]));
    atoms.set("delta", new Int32Array([-3, 4]));
    atoms.set("element", ["N", "H"]);
    original.box = new Box(
      Cell.matrix(new Float64Array([10, 1, 2, 0, 20, 3, 0, 0, 30])),
      new Float64Array([0, 0, 0]),
      [true, true, false],
    );
    original.setMeta("energy", -12.5);

    const { frame: wire, buffers } = encodeFrame(original);
    const views = buffers.map((b) => new DataView(b));
    const restored = decodeFrame(wire as unknown as WireFrame, views);

    const restoredAtoms = restored.has("atoms")
      ? restored.get("atoms")
      : undefined;
    expect(
      Array.from((restoredAtoms?.copy("x") as Float64Array) ?? []),
    ).toEqual([1.25, -2.5]);
    expect(
      Array.from((restoredAtoms?.copy("delta") as Int32Array) ?? []),
    ).toEqual([-3, 4]);
    expect((restoredAtoms?.copy("element") as string[]).map(String)).toEqual([
      "N",
      "H",
    ]);
    // Same cell in, same cell out — wire and Box.h() share row-major layout.
    expect(Array.from(restored.box?.lengths().toCopy() ?? [])[1]).toBeCloseTo(
      20.024984394500787,
      9,
    );
    expect(Array.from(restored.box?.tilts().toCopy() ?? [])).toEqual([1, 2, 3]);
    expect(restored.box?.pbc()).toEqual([true, true, false]);
    expect(restored.getMeta("energy")).toBeCloseTo(-12.5, 10);

    original.free();
    restored.free();
  });

  it("carries a grid block's shape", () => {
    const frame = new Frame();
    const grid = frame.createBlock("grid");
    grid.set("density", new Float64Array(8));
    grid.setShape([2, 2, 2]);

    const { frame: wire } = encodeFrame(frame);
    expect(wire.blocks.grid.shape).toEqual([2, 2, 2]);
    // A flat table carries no shape — its row count is already in the columns.
    frame.free();
  });
});

describe("wire column fidelity", () => {
  it("keeps column dimensions distinct from grid dimensions", () => {
    const original = new Frame();
    const grid = original.createBlock("grid");
    grid.set("vectors", new Float64Array([1, 2, 3, 4, 5, 6]), [2, 3]);
    grid.set("labels", ["a", "b", "c", "d"], [2, 2]);
    grid.setShape([1, 2]);
    const { frame: payload, buffers } = encodeFrame(original);
    const restored = decodeFrame(
      payload,
      buffers.map((b) => new DataView(b)),
    );
    expect(restored.get("grid").shape("vectors")).toEqual([2, 3]);
    expect(restored.get("grid").shape("labels")).toEqual([2, 2]);
    expect(restored.get("grid").structuralShape).toEqual([1, 2]);
    expect(
      Array.from(restored.get("grid").copy("vectors") as Float64Array),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    original.free();
    restored.free();
  });

  it("preserves every settable numeric width and bool", () => {
    const original = new Frame();
    const block = original.createBlock("custom");
    const columns = {
      small: new Int8Array([-128, 127]),
      medium: new Int16Array([-32768, 32767]),
      signed: new Int32Array([-2147483648, 2147483647]),
      large: new BigInt64Array([-(1n << 63n), (1n << 63n) - 1n]),
      byte: new Uint8Array([0, 255]),
      short: new Uint16Array([0, 65535]),
      word: new Uint32Array([0, 4294967295]),
      wide: new BigUint64Array([0n, (1n << 64n) - 1n]),
      real: new Float64Array([1.25, -2.5]),
      enabled: [true, false],
    };
    for (const [name, values] of Object.entries(columns))
      block.set(name, values);
    const encoded = encodeFrame(original);
    const restored = decodeFrame(
      encoded.frame,
      encoded.buffers.map((b) => new DataView(b)),
    );
    for (const name of Object.keys(columns)) {
      expect(restored.get("custom").dtype(name)).toBe(block.dtype(name));
      expect(restored.get("custom").copy(name)).toEqual(block.copy(name));
    }
    original.free();
    restored.free();
  });

  it("rejects malformed column shape with its path", () => {
    expect(() =>
      decodeFrame({
        blocks: {
          custom: {
            columns: {
              vector: {
                dtype: "f64",
                data: new Float64Array(6),
                shape: [2, 2],
              },
            },
          },
        },
      }),
    ).toThrow(/custom.vector/);
  });
});

it("rejects a u32 identity column instead of silently promoting it", () => {
  expect(() =>
    decodeFrame({
      blocks: {
        atoms: {
          columns: {
            id: { dtype: "u32", data: new Uint32Array([3, 7]) },
          },
        },
      },
    }),
  ).toThrow(/native setter changed dtype|atoms\.id/);
});

it("rejects column declarations the native setter cannot reconstruct", () => {
  for (const declaration of ["validity", "precision", "targets"] as const) {
    const source = new Frame();
    source
      .createBlock("custom")
      .set(
        "v",
        declaration === "targets"
          ? new BigUint64Array([1n, 2n])
          : new Float64Array([1, 2]),
      );
    const json = JSON.parse(
      new TextDecoder().decode(writeWireFrame(source, "json")),
    );
    json.blocks.custom[declaration] = {
      v:
        declaration === "validity"
          ? [true, false]
          : declaration === "precision"
            ? 0.01
            : "atoms",
    };
    const frame = readWireFrame(JSON.stringify(json), "json");
    expect(() => encodeFrame(frame)).toThrow(
      /custom.v: nullable columns and precision\/target declarations/,
    );
    source.free();
    frame.free();
  }
});

it("rejects complex columns rather than serializing an unusable carrier", () => {
  const frame = readWireFrame(
    JSON.stringify({
      blocks: {
        custom: {
          shape: [1],
          columns: {
            psi: {
              dtype: "c128",
              shape: [1],
              data: Array.from(new Uint8Array(new Float64Array([1, 2]).buffer)),
            },
          },
        },
      },
      meta: {},
    }),
    "json",
  );
  expect(() => encodeFrame(frame)).toThrow(/custom.psi.*c128/);
  frame.free();
});

it("rejects empty bool columns instead of changing them to string", () => {
  const frame = readWireFrame(
    JSON.stringify({
      blocks: {
        custom: {
          shape: [0],
          columns: {
            enabled: { dtype: "bool", shape: [0], data: [] },
          },
        },
      },
      meta: {},
    }),
    "json",
  );
  expect(() => encodeFrame(frame)).toThrow(/custom.enabled.*empty bool/);
  expect(() =>
    decodeFrame({
      blocks: {
        custom: {
          columns: { enabled: { dtype: "bool", data: [], shape: [0] } },
        },
      },
    }),
  ).toThrow(/custom.enabled.*changed dtype/);
  frame.free();
});
