import { describe, expect, it } from "@rstest/core";
import { rehydrateFrame } from "../../../src/transport/trajectory_worker/frame_codec";
import type {
  ColumnPayload,
  FrameMessage,
} from "../../../src/transport/trajectory_worker/protocol";

function emptyMessage(): FrameMessage {
  return {
    kind: "frame",
    requestId: 1,
    frameId: 0,
    blocks: [],
    box: null,
    grids: [],
  };
}

function atomsBlock(): FrameMessage["blocks"][number] {
  const cols: ColumnPayload[] = [
    { name: "x", dtype: "f64", data: new Float64Array([0, 1, 2]) },
    { name: "y", dtype: "f64", data: new Float64Array([3, 4, 5]) },
    { name: "z", dtype: "f64", data: new Float64Array([6, 7, 8]) },
    { name: "id", dtype: "u32", data: new Uint32Array([10, 11, 12]) },
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
    expect(frame.getBlock("atoms")).toBeUndefined();
    expect(frame.box).toBeUndefined();
    expect(frame.getBlock("grid")).toBeUndefined();
  });

  it("rebuilds an atoms block with all dtype variants", () => {
    const msg = emptyMessage();
    msg.blocks.push(atomsBlock());

    const frame = rehydrateFrame(msg);
    const atoms = frame.getBlock("atoms");
    expect(atoms).toBeDefined();
    if (!atoms) return;

    expect(atoms.nrows()).toBe(3);
    expect(Array.from(atoms.copyColF("x"))).toEqual([0, 1, 2]);
    expect(Array.from(atoms.copyColU32("id"))).toEqual([10, 11, 12]);
    expect(Array.from(atoms.copyColI32("source_id"))).toEqual([-1, 0, 1]);
    expect(atoms.copyColStr("element")).toEqual(["C", "O", "H"]);
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
        { name: "atomi", dtype: "u32", data: new Uint32Array([0, 1]) },
        { name: "atomj", dtype: "u32", data: new Uint32Array([1, 2]) },
        { name: "order", dtype: "f64", data: new Float64Array([1, 1.5]) },
      ],
    });
    const frame = rehydrateFrame(msg);
    expect(frame.getBlock("atoms")?.nrows()).toBe(3);
    expect(frame.getBlock("bonds")?.nrows()).toBe(2);
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

  it("reattaches a volumetric grid as a 'grid' block", () => {
    const msg = emptyMessage();
    const total = 2 * 2 * 2;
    msg.grids.push({
      name: "chgcar",
      shape: new Uint32Array([2, 2, 2]),
      origin: new Float64Array([0, 0, 0]),
      cell: new Float64Array([5, 0, 0, 0, 5, 0, 0, 0, 5]),
      pbc: [true, true, true],
      arrays: [
        {
          name: "rho",
          data: new Float64Array(total).fill(0.25),
        },
      ],
    });
    const frame = rehydrateFrame(msg);
    const block = frame.getBlock("grid");
    expect(block).toBeDefined();
    if (!block) return;
    expect(Array.from(block.shape())).toEqual([2, 2, 2]);
    expect(block.keys()).toContain("rho");
    const rho = block.copyColF("rho");
    expect(rho?.length).toBe(total);
    expect(rho?.[0]).toBe(0.25);
  });
});
