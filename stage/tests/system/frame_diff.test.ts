import type { Column, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  classifyFrameTransition,
  resolvePlaybackChangeKind,
} from "../../src/system/frame_diff";

interface AtomSpec {
  x: number;
  y: number;
  z: number;
  element: string;
  type?: string;
}

interface BondSpec {
  i: number;
  j: number;
  /** Display/Lewis order; 1.5 maps to aromatic bond_type=4. */
  order: number;
}

interface MockBlock {
  readonly nRows: number;
  has(name: string): boolean;
  dtype(name: string): string;
  view(name: string): Float64Array | BigUint64Array | Int32Array;
  copy(name: string): Column;
}

interface MockFrame {
  has(name: string): boolean;
  get(name: string): MockBlock | null;
}

function buildAtomBlock(atoms: AtomSpec[]): MockBlock {
  const columnsStr = new Map<string, string[]>([
    ["element", atoms.map((atom) => atom.element)],
  ]);

  if (atoms.some((atom) => atom.type !== undefined)) {
    columnsStr.set(
      "type",
      atoms.map((atom) => atom.type ?? ""),
    );
  }

  const x = new Float64Array(atoms.map((atom) => atom.x));
  const y = new Float64Array(atoms.map((atom) => atom.y));
  const z = new Float64Array(atoms.map((atom) => atom.z));

  const coord = (name: string): Float64Array => {
    if (name === "x") return x;
    if (name === "y") return y;
    if (name === "z") return z;
    throw new Error(`Column '${name}' not found`);
  };
  return {
    nRows: atoms.length,
    has(name: string) {
      return (
        name === "x" || name === "y" || name === "z" || columnsStr.has(name)
      );
    },
    dtype(name: string) {
      if (columnsStr.has(name)) return "string";
      coord(name); // throws when the column is absent, mirroring molrs
      return "float";
    },
    view(name: string) {
      return coord(name);
    },
    copy(name: string) {
      const col = columnsStr.get(name);
      if (!col) throw new Error(`Column '${name}' not found`);
      return col;
    },
  };
}

interface LammpsAtomSpec {
  x: number;
  y: number;
  z: number;
  /** LAMMPS dump `type` column is i32 — no `element` at all. */
  type: number;
}

function buildLammpsAtomBlock(atoms: LammpsAtomSpec[]): MockBlock {
  const typeCol = new Int32Array(atoms.map((atom) => atom.type));
  const coord = (name: string): Float64Array => {
    if (name === "x") return new Float64Array(atoms.map((atom) => atom.x));
    if (name === "y") return new Float64Array(atoms.map((atom) => atom.y));
    if (name === "z") return new Float64Array(atoms.map((atom) => atom.z));
    throw new Error(`Column '${name}' not found`);
  };
  return {
    nRows: atoms.length,
    has(name: string) {
      return name === "type" || name === "x" || name === "y" || name === "z";
    },
    dtype(name: string) {
      if (name === "type") return "int";
      coord(name); // throws when the column is absent, mirroring molrs
      return "float";
    },
    view(name: string) {
      if (name === "type") return typeCol;
      return coord(name);
    },
    copy(name: string) {
      throw new Error(`Column '${name}' not found or not string`);
    },
  };
}

function buildBondBlock(bonds: BondSpec[]): MockBlock {
  // molrs: bond_type + bond_number (u32). BondSpec.order 1.5 → aromatic type 4.
  const types = BigUint64Array.from(
    bonds.map((bond) =>
      BigInt(
        bond.order === 1.5
          ? 4
          : Math.max(1, Math.min(3, Math.round(bond.order))),
      ),
    ),
  );
  const numbers = BigUint64Array.from(
    bonds.map((bond) =>
      BigInt(
        bond.order === 1.5
          ? 0
          : Math.max(1, Math.min(3, Math.round(bond.order))),
      ),
    ),
  );
  const columnsU32 = new Map<string, BigUint64Array>([
    ["atomi", BigUint64Array.from(bonds.map((bond) => BigInt(bond.i)))],
    ["atomj", BigUint64Array.from(bonds.map((bond) => BigInt(bond.j)))],
    ["bond_type", types],
    ["bond_number", numbers],
  ]);

  return {
    nRows: bonds.length,
    has(name: string) {
      return columnsU32.has(name);
    },
    dtype(name: string) {
      if (!columnsU32.has(name)) throw new Error(`Column '${name}' not found`);
      return "uint";
    },
    view(name: string) {
      const col = columnsU32.get(name);
      if (!col) throw new Error(`Column '${name}' not found`);
      return col;
    },
    copy(name: string) {
      const col = columnsU32.get(name);
      if (!col) throw new Error(`Column '${name}' not found`);
      return new BigUint64Array(col);
    },
  };
}

function buildFrame(atoms: AtomSpec[], bonds?: BondSpec[]): Frame {
  const atomBlock = buildAtomBlock(atoms);
  const bondBlock = bonds && bonds.length > 0 ? buildBondBlock(bonds) : null;
  const frame: MockFrame = {
    has(name: string) {
      if (name === "atoms") return true;
      if (name === "bonds") return bondBlock !== null;
      return false;
    },
    get(name: string) {
      if (name === "atoms") return atomBlock;
      if (name === "bonds") return bondBlock;
      return null;
    },
  };
  return frame as unknown as Frame;
}

function buildLammpsFrame(atoms: LammpsAtomSpec[]): Frame {
  const atomBlock = buildLammpsAtomBlock(atoms);
  const frame: MockFrame = {
    has(name: string) {
      return name === "atoms";
    },
    get(name: string) {
      if (name === "atoms") return atomBlock;
      return null;
    },
  };
  return frame as unknown as Frame;
}

describe("classifyFrameTransition", () => {
  it("returns full when previous frame is missing", () => {
    const next = buildFrame([{ x: 0, y: 0, z: 0, element: "C" }]);
    const decision = classifyFrameTransition(null, next);
    expect(decision.kind).toBe("full");
  });

  it("returns full when atom count changes", () => {
    const previous = buildFrame([{ x: 0, y: 0, z: 0, element: "C" }]);
    const next = buildFrame([
      { x: 0, y: 0, z: 0, element: "C" },
      { x: 1, y: 0, z: 0, element: "H" },
    ]);
    const decision = classifyFrameTransition(previous, next);
    expect(decision.kind).toBe("full");
  });

  it("returns full when atom identity column changes", () => {
    const previous = buildFrame([
      { x: 0, y: 0, z: 0, element: "C" },
      { x: 1, y: 0, z: 0, element: "H" },
    ]);
    const next = buildFrame([
      { x: 0.2, y: 0, z: 0, element: "N" },
      { x: 1.2, y: 0, z: 0, element: "H" },
    ]);
    const decision = classifyFrameTransition(previous, next);
    expect(decision.kind).toBe("full");
  });

  it("returns bond when topology changes with stable counts", () => {
    const previous = buildFrame(
      [
        { x: 0, y: 0, z: 0, element: "C" },
        { x: 1, y: 0, z: 0, element: "H" },
        { x: 0, y: 1, z: 0, element: "H" },
      ],
      [
        { i: 0, j: 1, order: 1 },
        { i: 0, j: 2, order: 1 },
      ],
    );
    const next = buildFrame(
      [
        { x: 0.1, y: 0, z: 0, element: "C" },
        { x: 1.1, y: 0, z: 0, element: "H" },
        { x: 0.1, y: 1, z: 0, element: "H" },
      ],
      [
        { i: 0, j: 1, order: 1 },
        { i: 1, j: 2, order: 1 },
      ],
    );
    const decision = classifyFrameTransition(previous, next);
    expect(decision.kind).toBe("bond");
  });

  it("returns full when bond count changes", () => {
    const previous = buildFrame(
      [
        { x: 0, y: 0, z: 0, element: "C" },
        { x: 1, y: 0, z: 0, element: "H" },
        { x: 0, y: 1, z: 0, element: "H" },
      ],
      [{ i: 0, j: 1, order: 1 }],
    );
    const next = buildFrame(
      [
        { x: 0, y: 0, z: 0, element: "C" },
        { x: 1, y: 0, z: 0, element: "H" },
        { x: 0, y: 1, z: 0, element: "H" },
      ],
      [
        { i: 0, j: 1, order: 1 },
        { i: 0, j: 2, order: 1 },
      ],
    );
    const decision = classifyFrameTransition(previous, next);
    expect(decision.kind).toBe("full");
  });

  it("returns position on LAMMPS-style frames with no element column", () => {
    // Per convention, `element` is optional. Frames that only have `type`
    // still classify as `position` when atom count and coords structure match.
    const previous = buildLammpsFrame([
      { x: 0, y: 0, z: 0, type: 1 },
      { x: 1, y: 0, z: 0, type: 2 },
    ]);
    const next = buildLammpsFrame([
      { x: 0.1, y: 0, z: 0, type: 1 },
      { x: 1.1, y: 0, z: 0, type: 2 },
    ]);
    const decision = classifyFrameTransition(previous, next);
    expect(decision.kind).toBe("position");
  });

  it("is stable across repeated classification of the same pair (element cache)", () => {
    const previous = buildFrame([
      { x: 0, y: 0, z: 0, element: "C" },
      { x: 1, y: 0, z: 0, element: "H" },
    ]);
    const next = buildFrame([
      { x: 0.2, y: 0, z: 0, element: "C" },
      { x: 1.2, y: 0, z: 0, element: "H" },
    ]);
    // The element column is cached per-Frame; classifying twice must agree.
    expect(classifyFrameTransition(previous, next).kind).toBe("position");
    expect(classifyFrameTransition(previous, next).kind).toBe("position");
  });

  it("does not leak a cached element column across distinct frames", () => {
    // Reusing a frame as `previous` after it was `next` must compare against
    // the NEW counterpart's elements, not a stale cached pairing.
    const a = buildFrame([{ x: 0, y: 0, z: 0, element: "C" }]);
    const b = buildFrame([{ x: 0.1, y: 0, z: 0, element: "C" }]);
    const c = buildFrame([{ x: 0.2, y: 0, z: 0, element: "N" }]);
    expect(classifyFrameTransition(a, b).kind).toBe("position"); // C vs C
    expect(classifyFrameTransition(b, c).kind).toBe("full"); // C vs N
  });

  it("returns position when only coordinates change", () => {
    const previous = buildFrame(
      [
        { x: 0, y: 0, z: 0, element: "C" },
        { x: 1, y: 0, z: 0, element: "H" },
      ],
      [{ i: 0, j: 1, order: 1 }],
    );
    const next = buildFrame(
      [
        { x: 0.2, y: 0.1, z: 0, element: "C" },
        { x: 1.2, y: 0.1, z: 0, element: "H" },
      ],
      [{ i: 0, j: 1, order: 1 }],
    );
    const decision = classifyFrameTransition(previous, next);
    expect(decision.kind).toBe("position");
  });

  it("full-rebuilds playback only when the user enabled Create bonds", () => {
    const previous = buildFrame([
      { x: 0.2, y: 0, z: 0, element: "C" },
      { x: 1.5, y: 0, z: 0, element: "C" },
    ]);
    const next = buildFrame([
      { x: 0.3, y: 0, z: 0, element: "C" },
      { x: 1.6, y: 0, z: 0, element: "C" },
    ]);
    const decision = classifyFrameTransition(previous, next);
    expect(decision.kind).toBe("position");
    expect(resolvePlaybackChangeKind(decision, false)).toBe("position");
    expect(resolvePlaybackChangeKind(decision, true)).toBe("full");
  });

  it("classifies origin-sentinel occupancy changes as full, including reverse", () => {
    const f0 = buildFrame([
      { x: 1.4, y: 0, z: 0, element: "C" },
      { x: 2.8, y: 0, z: 0, element: "C" },
      { x: 0, y: 0, z: 0, element: "C" },
      { x: 0, y: 0, z: 0, element: "C" },
      { x: 0, y: 0, z: 0, element: "C" },
      { x: 0, y: 0, z: 0, element: "C" },
    ]);
    const f1 = buildFrame([
      { x: 1.4, y: 0, z: 0, element: "C" },
      { x: 2.8, y: 0, z: 0, element: "C" },
      { x: 4.2, y: 0, z: 0, element: "C" },
      { x: 5.6, y: 0, z: 0, element: "C" },
      { x: 0, y: 0, z: 0, element: "C" },
      { x: 0, y: 0, z: 0, element: "C" },
    ]);
    const forward = classifyFrameTransition(f0, f1);
    expect(forward.kind).toBe("full");
    expect(forward.reasons.join(" ")).toMatch(/Occupancy changed: 2 -> 4/);
    const reverse = classifyFrameTransition(f1, f0);
    expect(reverse.kind).toBe("full");
    expect(reverse.reasons.join(" ")).toMatch(/Occupancy changed: 4 -> 2/);
  });
});

describe("classifyFrameTransition with store section updates", () => {
  const water = (dx: number): AtomSpec[] => [
    { x: 0 + dx, y: 0, z: 0, element: "O" },
    { x: 1 + dx, y: 0, z: 0, element: "H" },
    { x: 2 + dx, y: 0, z: 0, element: "H" },
  ];
  const bonds: BondSpec[] = [
    { i: 0, j: 1, order: 1 },
    { i: 0, j: 2, order: 1 },
  ];
  const updates = (atoms: number, extra: Record<string, number> = {}) =>
    new Map<string, number>([["atoms", atoms], ...Object.entries(extra)]);

  it("keeps a position pass when only the atoms section updated", () => {
    // Elements differ on purpose: the index says topology is unchanged, so
    // the O(N) element compare must not even run.
    const previous = buildFrame(water(0), bonds);
    const next = buildFrame(
      water(1).map((a) => ({ ...a, element: "X" })),
      bonds,
    );
    const decision = classifyFrameTransition(previous, next, {
      previous: updates(4, { bonds: 1 }),
      next: updates(5, { bonds: 1 }),
    });
    expect(decision.kind).toBe("position");
    expect(decision.reasons[0]).toMatch(/Store index/);
  });

  it("rebuilds when a topology section's update id changed", () => {
    const previous = buildFrame(water(0), bonds);
    const next = buildFrame(water(1), bonds);
    const decision = classifyFrameTransition(previous, next, {
      previous: updates(4, { bonds: 1 }),
      next: updates(5, { bonds: 2 }),
    });
    expect(decision.kind).toBe("full");
    expect(decision.reasons[0]).toMatch(/bonds block updated \(1 -> 2\)/);
  });

  it("rebuilds when a section appears or disappears", () => {
    const previous = buildFrame(water(0), bonds);
    const next = buildFrame(water(1), bonds);
    expect(
      classifyFrameTransition(previous, next, {
        previous: updates(0),
        next: updates(1, { angles: 0 }),
      }).kind,
    ).toBe("full");
    expect(
      classifyFrameTransition(previous, next, {
        previous: updates(0, { angles: 0 }),
        next: updates(1),
      }).kind,
    ).toBe("full");
  });

  it("still rebuilds on an atom-count change even with a quiet index", () => {
    const previous = buildFrame(water(0), bonds);
    const next = buildFrame(water(1).slice(0, 2), bonds);
    const decision = classifyFrameTransition(previous, next, {
      previous: updates(4, { bonds: 1 }),
      next: updates(5, { bonds: 1 }),
    });
    expect(decision.kind).toBe("full");
    expect(decision.reasons[0]).toMatch(/Atom count changed/);
  });

  it("falls back to value compares when either side has no index", () => {
    const previous = buildFrame(water(0), bonds);
    const next = buildFrame(
      water(1).map((a) => ({ ...a, element: "X" })),
      bonds,
    );
    const decision = classifyFrameTransition(previous, next, {
      previous: undefined,
      next: updates(5, { bonds: 1 }),
    });
    expect(decision.kind).toBe("full");
    expect(decision.reasons[0]).toMatch(/element column changed/);
  });
});
