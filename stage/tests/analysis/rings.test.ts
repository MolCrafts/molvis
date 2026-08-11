import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { detectRings } from "../../src/analysis/rings";

/** Planar benzene-like C6 ring with single bonds (topology only). */
function benzeneLike(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  const n = 6;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const elements: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * Math.PI * 2) / n;
    x[i] = Math.cos(a);
    y[i] = Math.sin(a);
    z[i] = 0;
    elements.push("C");
  }
  atoms.setColF("x", x);
  atoms.setColF("y", y);
  atoms.setColF("z", z);
  atoms.setColStr("element", elements);
  frame.insertBlock("atoms", atoms);

  const bonds = new Block();
  const atomi = new Uint32Array(n);
  const atomj = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    atomi[i] = i;
    atomj[i] = (i + 1) % n;
  }
  bonds.setColU32("atomi", atomi);
  bonds.setColU32("atomj", atomj);
  bonds.setColU32("bond_type", new Uint32Array(n).fill(1));
  bonds.setColU32("bond_number", new Uint32Array(n).fill(1));
  frame.insertBlock("bonds", bonds);
  return frame;
}

describe("detectRings", () => {
  it("returns null when there are no bonds", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0]));
    atoms.setColF("y", new Float64Array([0]));
    atoms.setColF("z", new Float64Array([0]));
    frame.insertBlock("atoms", atoms);
    expect(detectRings(frame)).toBeNull();
  });

  it("finds a 6-ring and a full atom mask", () => {
    const info = detectRings(benzeneLike());
    expect(info).not.toBeNull();
    expect(info!.numRings).toBeGreaterThanOrEqual(1);
    expect(info!.atomRingMask.length).toBe(6);
    // Every atom is on the ring.
    for (let i = 0; i < 6; i++) {
      expect(info!.atomRingMask[i]).toBe(1);
    }
    const hasSix = Array.from(info!.ringSizes).some((s) => s === 6);
    expect(hasSix).toBe(true);
  });
});
