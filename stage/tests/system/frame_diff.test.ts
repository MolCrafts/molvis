import type { Frame } from "@molcrafts/molvis-core/molrs";
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

type MockColumn = Float64Array | BigUint64Array | Int32Array | string[];

/** The molrs `Block` surface `frame_diff` reads, over plain columns. */
class MockBlock {
  constructor(
    readonly nRows: number,
    private readonly columns: ReadonlyMap<string, MockColumn>,
  ) {}

  keys(): string[] {
    return [...this.columns.keys()];
  }

  has(name: string): boolean {
    return this.columns.has(name);
  }

  dtype(name: string): string {
    const column = this.column(name);
    if (Array.isArray(column)) return "string";
    if (column instanceof Float64Array) return "float";
    if (column instanceof Int32Array) return "int";
    return "uint";
  }

  view(name: string): Float64Array | BigUint64Array | Int32Array {
    const column = this.column(name);
    if (Array.isArray(column)) {
      throw new Error(`column '${name}' is a string column`);
    }
    return column;
  }

  copy(name: string): MockColumn {
    const column = this.column(name);
    return Array.isArray(column) ? [...column] : column.slice();
  }

  private column(name: string): MockColumn {
    const column = this.columns.get(name);
    if (!column) throw new Error(`column '${name}' not found`);
    return column;
  }
}

/** The molrs `Frame` surface `frame_diff` reads. */
class MockFrame {
  constructor(private readonly blocks: ReadonlyMap<string, MockBlock>) {}

  has(name: string): boolean {
    return this.blocks.has(name);
  }

  get(name: string): MockBlock {
    const block = this.blocks.get(name);
    if (!block) throw new Error(`block '${name}' not found`);
    return block;
  }
}

function buildAtomBlock(atoms: AtomSpec[]): MockBlock {
  const columns = new Map<string, MockColumn>([
    ["x", new Float64Array(atoms.map((atom) => atom.x))],
    ["y", new Float64Array(atoms.map((atom) => atom.y))],
    ["z", new Float64Array(atoms.map((atom) => atom.z))],
    ["element", atoms.map((atom) => atom.element)],
  ]);
  if (atoms.some((atom) => atom.type !== undefined)) {
    columns.set(
      "type",
      atoms.map((atom) => atom.type ?? ""),
    );
  }
  return new MockBlock(atoms.length, columns);
}

interface LammpsAtomSpec {
  x: number;
  y: number;
  z: number;
  /** LAMMPS dump `type` column is int — no `element` at all. */
  type: number;
}

function buildLammpsAtomBlock(atoms: LammpsAtomSpec[]): MockBlock {
  return new MockBlock(
    atoms.length,
    new Map<string, MockColumn>([
      ["x", new Float64Array(atoms.map((atom) => atom.x))],
      ["y", new Float64Array(atoms.map((atom) => atom.y))],
      ["z", new Float64Array(atoms.map((atom) => atom.z))],
      ["type", new Int32Array(atoms.map((atom) => atom.type))],
    ]),
  );
}

function buildBondBlock(bonds: BondSpec[]): MockBlock {
  // molrs: bond_type + bond_number (uint). BondSpec.order 1.5 → aromatic type 4.
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
  return new MockBlock(
    bonds.length,
    new Map<string, MockColumn>([
      ["atomi", BigUint64Array.from(bonds.map((bond) => BigInt(bond.i)))],
      ["atomj", BigUint64Array.from(bonds.map((bond) => BigInt(bond.j)))],
      ["bond_type", types],
      ["bond_number", numbers],
    ]),
  );
}

function buildFrame(atoms: AtomSpec[], bonds?: BondSpec[]): Frame {
  const blocks = new Map<string, MockBlock>([["atoms", buildAtomBlock(atoms)]]);
  if (bonds && bonds.length > 0) blocks.set("bonds", buildBondBlock(bonds));
  return new MockFrame(blocks) as unknown as Frame;
}

function buildLammpsFrame(atoms: LammpsAtomSpec[]): Frame {
  return new MockFrame(
    new Map([["atoms", buildLammpsAtomBlock(atoms)]]),
  ) as unknown as Frame;
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
