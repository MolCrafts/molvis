import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
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
  atoms.set("x", x);
  atoms.set("y", y);
  atoms.set("z", z);
  atoms.set("element", elements);
  frame.set("atoms", atoms);

  const bonds = new Block();
  const atomi = new Uint32Array(n);
  const atomj = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    atomi[i] = i;
    atomj[i] = (i + 1) % n;
  }
  bonds.set("atomi", toDomainUint(atomi));
  bonds.set("atomj", toDomainUint(atomj));
  bonds.set("bond_type", toDomainUint(new Uint32Array(n).fill(1)));
  bonds.set("bond_number", toDomainUint(new Uint32Array(n).fill(1)));
  frame.set("bonds", bonds);
  return frame;
}

describe("detectRings", () => {
  it("returns null when there are no bonds", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", new Float64Array([0]));
    atoms.set("y", new Float64Array([0]));
    atoms.set("z", new Float64Array([0]));
    frame.set("atoms", atoms);
    expect(detectRings(frame)).toBeNull();
  });

  it("finds the one ring and a full atom mask", () => {
    const info = detectRings(benzeneLike());
    expect(info).not.toBeNull();
    expect(info!.numRings).toBe(1);
    expect(info!.atomRingMask.length).toBe(6);
    // Every atom is on the ring.
    for (let i = 0; i < 6; i++) {
      expect(info!.atomRingMask[i]).toBe(1);
    }
  });
});
