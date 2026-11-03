import { Box, Cell, type Column, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  encodeFrame,
  rehydrateFrame,
} from "../../../src/transport/trajectory_worker/frame_codec";
import {
  type ColumnPayload,
  type FrameMessage,
  frameMessageTransferList,
} from "../../../src/transport/trajectory_worker/protocol";

function emptyMessage(): FrameMessage {
  return {
    kind: "frame",
    frameId: 0,
    blocks: [],
    box: null,
  };
}

function atomsBlock(): FrameMessage["blocks"][number] {
  const cols: ColumnPayload[] = [
    { name: "x", dtype: "f64", data: new Float64Array([0, 1, 2]) },
    { name: "y", dtype: "f64", data: new Float64Array([3, 4, 5]) },
    { name: "z", dtype: "f64", data: new Float64Array([6, 7, 8]) },
    { name: "id", dtype: "u64", data: new BigUint64Array([10n, 11n, 12n]) },
    // The i32 carrier has to be a key the schema leaves unconstrained: no
    // canonical column is Int (every identifier is unsigned, every physical
    // quantity float), so a canonical key like `type_id` (UInt) would be
    // rejected on insert. `source_id` is the same i32 extension column
    // source_composition writes.
    { name: "source_id", dtype: "i32", data: new Int32Array([-1, 0, 1]) },
    { name: "element", dtype: "string", data: ["C", "O", "H"] },
  ];
  return { name: "atoms", columns: cols };
}

describe("rehydrateFrame", () => {
  it("builds an empty Frame from an empty message", () => {
    const frame = rehydrateFrame(emptyMessage());
    expect(frame.has("atoms")).toBe(false);
    expect(frame.box).toBeUndefined();
    expect(frame.has("grid")).toBe(false);
  });

  it("rebuilds an atoms block with all dtype variants", () => {
    const msg = emptyMessage();
    msg.blocks.push(atomsBlock());

    const frame = rehydrateFrame(msg);
    const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
    expect(atoms).toBeDefined();
    if (!atoms) return;

    expect(atoms.nRows).toBe(3);
    expect(Array.from(atoms.copy("x") as Float64Array)).toEqual([0, 1, 2]);
    expect(Array.from(atoms.copy("id") as BigUint64Array, Number)).toEqual([
      10, 11, 12,
    ]);
    expect(Array.from(atoms.copy("source_id") as Int32Array)).toEqual([
      -1, 0, 1,
    ]);
    expect([...(atoms.copy("element") as string[])]).toEqual(["C", "O", "H"]);
  });

  it("throws on an unknown column dtype instead of dropping the column", () => {
    // A malformed worker payload must not yield a Frame that is quietly
    // missing a column — `runtime.onFrame` turns the throw into a rejected
    // frame request, which is observable.
    const msg = emptyMessage();
    msg.blocks.push({
      name: "atoms",
      columns: [
        { name: "x", dtype: "f64", data: new Float64Array([0, 1]) },
        { name: "flag", dtype: "future", data: [true, false] },
      ] as unknown as ColumnPayload[],
    });

    expect(() => rehydrateFrame(msg)).toThrow(
      /unknown column dtype "future" for column "flag" in block "atoms"/,
    );
  });

  it("preserves block ordering and supports multiple blocks", () => {
    const msg = emptyMessage();
    msg.blocks.push(atomsBlock());
    msg.blocks.push({
      name: "bonds",
      columns: [
        { name: "atomi", dtype: "u64", data: new BigUint64Array([0n, 1n]) },
        { name: "atomj", dtype: "u64", data: new BigUint64Array([1n, 2n]) },
        { name: "order", dtype: "f64", data: new Float64Array([1, 1.5]) },
      ],
    });
    const frame = rehydrateFrame(msg);
    expect(frame.get("atoms").nRows).toBe(3);
    expect(frame.get("bonds").nRows).toBe(2);
  });

  it("reattaches a triclinic box from row-major worker data", () => {
    const msg = emptyMessage();
    msg.box = {
      h: new Float64Array([10, 0, 0, 2, 12, 0, -3, 4, 14]),
      origin: new Float64Array([1, 2, 3]),
      pbc: [true, true, false],
    };
    const frame = rehydrateFrame(msg);
    const box = frame.box;
    expect(box?.h().toCopy()).toEqual(msg.box.h);
    expect(box?.origin().toCopy()).toEqual(msg.box.origin);
    expect(box?.pbc()).toEqual(msg.box.pbc);
    // Rehydrate must not mutate the received payload.
    expect(Array.from(msg.box.h)).toEqual([10, 0, 0, 2, 12, 0, -3, 4, 14]);
  });

  it("reapplies a volumetric block's shape", () => {
    const msg = emptyMessage();
    const total = 2 * 2 * 2;
    msg.blocks.push({
      name: "grid",
      columns: [
        { name: "rho", dtype: "f64", data: new Float64Array(total).fill(0.25) },
      ],
      shape: new Uint32Array([2, 2, 2]),
    });
    const frame = rehydrateFrame(msg);
    const block = frame.get("grid");
    expect(block.structuralShape).toEqual([2, 2, 2]);
    const rho = block.copy("rho") as Float64Array;
    expect(rho.length).toBe(total);
    expect(rho[0]).toBe(0.25);
  });

  it.each([8, 10])("rejects a cell matrix with %i values", (length) => {
    const msg = emptyMessage();
    const h = new Float64Array(length);
    h.set([10, 0, 0, 2, 12, 0, -3, 4, 14].slice(0, length));
    msg.box = { h, origin: new Float64Array(3), pbc: [true, true, true] };
    expect(() => rehydrateFrame(msg)).toThrow(/h must be 9 values/);
  });
});

describe("encodeFrame string meta", () => {
  it("carries a word-valued label the numeric getter cannot see", () => {
    // A LAMMPS `dump local` section label is the only signal that the local
    // rows are bonds. It is a string, so a numbers-only payload dropped it
    // and the streamed copy of a frame lost what the whole-file copy kept.
    const source = new Frame();
    const entries = source.createBlock("entries");
    entries.set("c_bond[1]", new BigUint64Array([1n, 2n]));
    source.setMeta("dump_local_label", "BONDS");
    source.setMeta("timestep", 500);

    const msg = encodeFrame(source, 0, {});
    expect(msg.metaText).toEqual({ dump_local_label: "BONDS" });
    expect(msg.meta).toEqual({ timestep: 500 });

    const restored = rehydrateFrame(msg);
    expect(restored.getMeta("dump_local_label")).toBe("BONDS");
    expect(restored.getMeta("timestep")).toBe(500);
  });

  it("omits the string map when the frame has no word-valued meta", () => {
    const source = new Frame();
    source.createBlock("atoms").set("x", new Float64Array([0]));
    source.setMeta("step", 1);
    expect(encodeFrame(source, 0, {}).metaText).toBeUndefined();
  });
});

describe("encodeFrame", () => {
  it.each([
    { dtype: "u8", data: Uint8Array.of(1, 2) },
    { dtype: "u16", data: Uint16Array.of(1, 2) },
    { dtype: "u32", data: Uint32Array.of(1, 2) },
    { dtype: "i8", data: Int8Array.of(-1, 2) },
    { dtype: "i16", data: Int16Array.of(-1, 2) },
    { dtype: "i64", data: BigInt64Array.of(-1n, 2n) },
    { dtype: "bool", data: [true, false] },
  ])("preserves $dtype columns through structured clone", ({ dtype, data }) => {
    const source = new Frame();
    source.createBlock("atoms").set("extension", data as Column);
    const msg = encodeFrame(source, 0);
    const back = rehydrateFrame(structuredClone(msg));
    expect(back.get("atoms").dtype("extension")).toBe(dtype);
    expect(
      Array.from(back.get("atoms").copy("extension") as ArrayLike<unknown>),
    ).toEqual(Array.from(data as ArrayLike<unknown>));
    const transferred = frameMessageTransferList(msg);
    expect(transferred.length).toBe(dtype === "bool" ? 0 : 1);
  });

  it("preserves column shape independently of the block's shape", () => {
    const source = new Frame();
    const block = source.createBlock("grid");
    block.set("vector", Float64Array.of(1, 2, 3, 4, 5, 6), [2, 3]);
    block.set("scalar", Float64Array.of(7, 8));
    block.setShape([1, 2]);
    const back = rehydrateFrame(structuredClone(encodeFrame(source, 0)));
    expect(back.get("grid").shape("vector")).toEqual([2, 3]);
    expect(back.get("grid").structuralShape).toEqual([1, 2]);
    expect(Array.from(back.get("grid").copy("vector") as Float64Array)).toEqual(
      [1, 2, 3, 4, 5, 6],
    );
  });

  it("carries only blocks retained by the next frame's section index", () => {
    const previous = new Frame();
    previous.createBlock("bonds").set("flag", [true]);
    previous.createBlock("grid").set("rho", Float64Array.of(1));
    const msg = emptyMessage();
    msg.sectionUpdates = { bonds: 0 };
    const next = rehydrateFrame(msg, previous);
    expect(next.has("grid")).toBe(false);
    expect(Array.from(next.get("bonds").copy("flag") as boolean[])).toEqual([
      true,
    ]);
    expect(rehydrateFrame(emptyMessage(), previous).keys()).toEqual([]);
  });
  it("preserves exact integer metadata across structured clone", () => {
    const source = new Frame();
    source.setMeta("timestep", 500n);
    source.setMeta("count", 18446744073709551615n);
    source.setMeta("offset", -9223372036854775808n);
    source.setMeta("enabled", true);
    source.setMeta("vector", Float64Array.of(1, 2, 3));
    source.setMeta("run", { name: "sample", sequence: [1, 2] });
    const restored = rehydrateFrame(structuredClone(encodeFrame(source, 0)));
    try {
      expect(restored.getMeta("timestep")).toBe(500n);
      expect(restored.getMeta("count")).toBe(18446744073709551615n);
      expect(restored.getMeta("offset")).toBe(-9223372036854775808n);
      expect(restored.getMeta("enabled")).toBe(true);
      expect(restored.getMeta("vector")).toEqual(Float64Array.of(1, 2, 3));
      expect(restored.getMeta("run")).toEqual({
        name: "sample",
        sequence: [1, 2],
      });
    } finally {
      source.free();
      restored.free();
    }
  });
  it("round-trips blocks, box, meta, and a grid shape through the wire", () => {
    const source = new Frame();
    const atoms = source.createBlock("atoms");
    atoms.set("x", new Float64Array([0, 1.5]));
    atoms.set("id", new BigUint64Array([1n, 2n]));
    atoms.set("source_id", new Int32Array([-1, 4]));
    atoms.set("element", ["C", "O"]);
    const grid = source.createBlock("grid");
    grid.set("rho", new Float64Array(8).fill(0.5));
    grid.setShape([2, 2, 2]);
    source.box = new Box(
      Cell.matrix(new Float64Array([10, 2, -3, 0, 12, 4, 0, 0, 14])),
      new Float64Array([1, 2, 3]),
      [true, false, true],
    );
    source.setMeta("step", 42);

    const msg = encodeFrame(source, 7, { sectionUpdates: { atoms: 3 } });
    expect(msg.frameId).toBe(7);
    expect(msg.sectionUpdates).toEqual({ atoms: 3 });
    expect(msg.meta).toEqual({ step: 42 });
    const encodedAtoms = msg.blocks.find((b) => b.name === "atoms");
    expect(encodedAtoms?.shape).toBeUndefined();
    expect(encodedAtoms?.columns.map((c) => c.dtype).sort()).toEqual([
      "f64",
      "i32",
      "string",
      "u64",
    ]);
    const encodedGrid = msg.blocks.find((b) => b.name === "grid");
    expect(Array.from(encodedGrid?.shape ?? [])).toEqual([2, 2, 2]);
    expect(msg.box?.pbc).toEqual([true, false, true]);
    expect(Array.from(msg.box?.h ?? [])).toEqual([
      10, 2, -3, 0, 12, 4, 0, 0, 14,
    ]);
    expect(Array.from(msg.box?.origin ?? [])).toEqual([1, 2, 3]);
    // Every typed array is JS-owned: transferring it must not touch wasm.
    expect(frameMessageTransferList(msg).length).toBeGreaterThan(0);

    const back = rehydrateFrame(structuredClone(msg));
    const backAtoms = back.has("atoms") ? back.get("atoms") : undefined;
    expect(Array.from((backAtoms?.copy("x") as Float64Array) ?? [])).toEqual([
      0, 1.5,
    ]);
    expect(
      Array.from((backAtoms?.copy("id") as BigUint64Array) ?? [], Number),
    ).toEqual([1, 2]);
    expect(
      Array.from((backAtoms?.copy("source_id") as Int32Array) ?? []),
    ).toEqual([-1, 4]);
    expect([...(backAtoms?.copy("element") as string[])]).toEqual(["C", "O"]);
    expect(back.get("grid").structuralShape).toEqual([2, 2, 2]);
    expect(back.getMeta("step")).toBe(42);
    const h = back.box?.h().toCopy();
    expect(Array.from(h ?? [])).toEqual([10, 2, -3, 0, 12, 4, 0, 0, 14]);
    source.free();
    back.free();
  });

  it("encodes an empty frame as an empty message", () => {
    const frame = new Frame();
    const msg = encodeFrame(frame, 0);
    expect(msg.blocks).toEqual([]);
    expect(msg.box).toBeNull();
    expect(msg.meta).toBeUndefined();
    expect(msg.sectionUpdates).toBeUndefined();
    frame.free();
  });
});
