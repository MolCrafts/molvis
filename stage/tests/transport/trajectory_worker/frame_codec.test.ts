import { Box, Frame } from "@molcrafts/molvis-core/molrs";
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
        { name: "flag", dtype: "bool", data: [true, false] },
      ] as unknown as ColumnPayload[],
    });

    expect(() => rehydrateFrame(msg)).toThrow(
      /unknown column dtype "bool" for column "flag" in block "atoms"/,
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

  it("reattaches a triclinic box via Box(h, origin, pbc)", () => {
    const msg = emptyMessage();
    msg.box = {
      // 10 Å cube column-major
      h: new Float64Array([10, 0, 0, 0, 10, 0, 0, 0, 10]),
      origin: new Float64Array([0, 0, 0]),
      pbc: [true, true, false],
    };
    const frame = rehydrateFrame(msg);
    expect(frame.box).toBeDefined();
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
    source.setMetaScalar("timestep", 500);

    const msg = encodeFrame(source, 0, {});
    expect(msg.metaText).toEqual({ dump_local_label: "BONDS" });
    expect(msg.meta).toEqual({ timestep: 500 });

    const restored = rehydrateFrame(msg);
    expect(restored.getMeta("dump_local_label")).toBe("BONDS");
    expect(restored.getMetaScalar("timestep")).toBe(500);
  });

  it("omits the string map when the frame has no word-valued meta", () => {
    const source = new Frame();
    source.createBlock("atoms").set("x", new Float64Array([0]));
    source.setMetaScalar("step", 1);
    expect(encodeFrame(source, 0, {}).metaText).toBeUndefined();
  });
});

describe("encodeFrame", () => {
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
      new Float64Array([10, 0, 0, 0, 12, 0, 0, 0, 14]),
      new Float64Array([1, 2, 3]),
      true,
      false,
      true,
    );
    source.setMetaScalar("step", 42);

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
    expect(Array.from(msg.box?.origin ?? [])).toEqual([1, 2, 3]);
    // Every typed array is JS-owned: transferring it must not touch wasm.
    expect(frameMessageTransferList(msg).length).toBeGreaterThan(0);

    const back = rehydrateFrame(msg);
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
    expect(back.getMetaScalar("step")).toBe(42);
    const h = back.box?.h().toCopy();
    expect(h?.[0]).toBe(10);
    expect(h?.[4]).toBe(12);
    expect(h?.[8]).toBe(14);
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
