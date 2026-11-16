import { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { MoleculeGraph } from "../src/molecule_graph";
import type { MoleculeData } from "../src/types";

const H2O: MoleculeData = {
  atoms: [
    { element: "O", x: 0, y: 0 },
    { element: "H", x: 1, y: 0.5 },
    { element: "H", x: 1, y: -0.5 },
  ],
  bonds: [
    { i: 0, j: 1, order: 1 },
    { i: 0, j: 2, order: 1 },
  ],
};

describe("MoleculeGraph", () => {
  it("rejects missing species without clearing the existing graph", () => {
    const graph = new MoleculeGraph();
    graph.loadMoleculeData(H2O);
    const frame = new Frame();
    try {
      frame.createBlock("atoms").set("type", ["water"]);
      expect(() => graph.fromFrame(frame)).toThrow(/species/);
      expect(graph.getMoleculeData()).toEqual(H2O);
    } finally {
      frame.free();
    }
  });
  it("loadMoleculeData then getMoleculeData returns deep equal copy", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData(H2O);
    const a = g.getMoleculeData();
    const b = g.getMoleculeData();
    expect(a).toEqual(H2O);
    expect(a).toEqual(b);
    expect(a.atoms).not.toBe(b.atoms);
    expect(a.bonds).not.toBe(b.bonds);
    a.atoms[0].element = "X";
    expect(g.getMoleculeData().atoms[0].element).toBe("O");
  });

  it("toFrame writes element + atomi/atomj + bond_type/bond_number for the conformer", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData(H2O);
    const frame = g.toFrame();
    try {
      const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
      expect(atoms).toBeDefined();
      expect([...(atoms?.copy("element") as string[])]).toEqual([
        "O",
        "H",
        "H",
      ]);
      const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
      expect(bonds).toBeDefined();
      expect(
        Array.from((bonds?.copy("atomi") as BigUint64Array) ?? [], Number),
      ).toEqual([0, 0]);
      expect(
        Array.from((bonds?.copy("atomj") as BigUint64Array) ?? [], Number),
      ).toEqual([1, 2]);
      expect(
        Array.from((bonds?.copy("bond_type") as BigUint64Array) ?? [], Number),
      ).toEqual([1, 1]);
      expect(
        Array.from(
          (bonds?.copy("bond_number") as BigUint64Array) ?? [],
          Number,
        ),
      ).toEqual([1, 1]);
    } finally {
      frame.free();
    }
  });

  it("toFrame preserves Kekulé double-bond orders as bond_type/bond_number", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: Array.from({ length: 6 }, (_, i) => ({
        element: "C",
        x: i,
        y: 0,
      })),
      bonds: [
        { i: 0, j: 1, order: 2 },
        { i: 1, j: 2, order: 1 },
        { i: 2, j: 3, order: 2 },
        { i: 3, j: 4, order: 1 },
        { i: 4, j: 5, order: 2 },
        { i: 5, j: 0, order: 1 },
      ],
    });
    const frame = g.toFrame();
    try {
      const bonds = frame.has("bonds") ? frame.get("bonds") : undefined;
      expect(
        Array.from((bonds?.copy("bond_type") as BigUint64Array) ?? [], Number),
      ).toEqual([2, 1, 2, 1, 2, 1]);
      expect(
        Array.from(
          (bonds?.copy("bond_number") as BigUint64Array) ?? [],
          Number,
        ),
      ).toEqual([2, 1, 2, 1, 2, 1]);
    } finally {
      frame.free();
    }
  });

  it("toFrame omits bonds block when no bonds", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [{ element: "C", x: 0, y: 0 }],
      bonds: [],
    });
    const frame = g.toFrame();
    try {
      expect(frame.get("atoms").nRows).toBe(1);
      expect(frame.has("bonds")).toBe(false);
    } finally {
      frame.free();
    }
  });

  it("toFrame then fromFrame preserves topology", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData(H2O);
    const frame = g.toFrame();
    try {
      const g2 = new MoleculeGraph();
      g2.fromFrame(frame);
      const data = g2.getMoleculeData();
      expect(data.atoms.map((a) => a.element)).toEqual(["O", "H", "H"]);
      expect(data.bonds).toEqual([
        { i: 0, j: 1, order: 1 },
        { i: 0, j: 2, order: 1 },
      ]);
      // No 2D coords on the frame → a depiction, not a straight line:
      // unit bonds and a 120° H–O–H angle.
      const [o, h1, h2] = data.atoms;
      expect(Math.hypot(h1.x - o.x, h1.y - o.y)).toBeCloseTo(1, 6);
      expect(Math.hypot(h2.x - o.x, h2.y - o.y)).toBeCloseTo(1, 6);
      const cos =
        ((h1.x - o.x) * (h2.x - o.x) + (h1.y - o.y) * (h2.y - o.y)) /
        (Math.hypot(h1.x - o.x, h1.y - o.y) *
          Math.hypot(h2.x - o.x, h2.y - o.y));
      expect(cos).toBeCloseTo(-0.5, 6);
    } finally {
      frame.free();
    }
  });

  it("loadMoleculeData rejects bond out of range", () => {
    const g = new MoleculeGraph();
    expect(() =>
      g.loadMoleculeData({
        atoms: [{ element: "C", x: 0, y: 0 }],
        bonds: [{ i: 0, j: 1, order: 1 }],
      }),
    ).toThrow();
  });

  it("rejects invalid topology transactionally", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData(H2O);
    const before = g.getMoleculeData();

    expect(() =>
      g.loadMoleculeData({
        atoms: [
          { element: "C", x: 0, y: 0 },
          { element: "C", x: 1, y: 0 },
        ],
        bonds: [
          { i: 0, j: 1, order: 1 },
          { i: 1, j: 0, order: 1 },
        ],
      }),
    ).toThrow(/duplicate bond/);
    expect(g.getMoleculeData()).toEqual(before);

    expect(() =>
      g.loadMoleculeData({
        atoms: [{ element: "C", x: Number.NaN, y: 0 }],
        bonds: [],
      }),
    ).toThrow(/coordinates must be finite/);
    expect(g.getMoleculeData()).toEqual(before);
  });

  it("round-trips custom colors without leaking references", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData({
      atoms: [
        { element: "N", x: 0, y: 0, color: "#7c3aed" },
        { element: "O", x: 1, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 1, color: "#008000" }],
    });
    const first = g.getMoleculeData();
    const second = g.getMoleculeData();
    expect(first).toEqual({
      atoms: [
        { element: "N", x: 0, y: 0, color: "#7c3aed" },
        { element: "O", x: 1, y: 0 },
      ],
      bonds: [{ i: 0, j: 1, order: 1, color: "#008000" }],
    });
    expect(first.atoms).not.toBe(second.atoms);
    expect(first.bonds).not.toBe(second.bonds);
    first.atoms[0].color = "#ffffff";
    expect(g.getAtom(0).color).toBe("#7c3aed");
  });

  it("rejects invalid custom colors transactionally", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData(H2O);
    const before = g.getMoleculeData();
    expect(() =>
      g.loadMoleculeData({
        atoms: [{ element: "C", x: 0, y: 0, color: "red" }],
        bonds: [],
      }),
    ).toThrow(/invalid color/);
    expect(g.getMoleculeData()).toEqual(before);
  });

  it("rejects self-bonds, unsupported orders, and stereo on multiple bonds", () => {
    const g = new MoleculeGraph();
    const atoms = [
      { element: "C", x: 0, y: 0 },
      { element: "C", x: 1, y: 0 },
    ];
    expect(() =>
      g.loadMoleculeData({
        atoms,
        bonds: [{ i: 0, j: 0, order: 1 }],
      }),
    ).toThrow(/distinct/);
    expect(() =>
      g.loadMoleculeData({
        atoms,
        bonds: [{ i: 0, j: 1, order: 4 }],
      }),
    ).toThrow(/1, 2, or 3/);
    expect(() =>
      g.loadMoleculeData({
        atoms,
        bonds: [{ i: 0, j: 1, order: 2, stereo: "up" }],
      }),
    ).toThrow(/single bonds/);
  });

  it("empty molecule has zero atoms", () => {
    const g = new MoleculeGraph();
    expect(g.getMoleculeData()).toEqual({ atoms: [], bonds: [] });
    expect(g.atomCount()).toBe(0);
  });

  it("fromFrame reads charges, implicit hydrogens and molpy ports", () => {
    const frame = new Frame();
    try {
      const atoms = frame.createBlock("atoms");
      atoms.set("element", ["N", "C", "O"]);
      atoms.set("formal_charge", new BigInt64Array([1n, 0n, -1n]));
      atoms.set("h_count", new BigUint64Array([3n, 2n, 0n]));
      const bonds = frame.createBlock("bonds");
      bonds.set("atomi", new BigUint64Array([0n, 1n]));
      bonds.set("atomj", new BigUint64Array([1n, 2n]));
      bonds.set("bond_type", new BigUint64Array([1n, 1n]));
      bonds.set("bond_number", new BigUint64Array([1n, 1n]));
      const ports = frame.createBlock("ports");
      ports.set("atomi", new BigUint64Array([1n]));
      ports.set("atomj", new BigUint64Array([2n]));
      ports.set("port_kind", ["$"]);
      ports.set("port_label", ["R"]);
      const g = new MoleculeGraph();
      g.fromFrame(frame);
      const data = g.getMoleculeData();
      expect(data.atoms.map((a) => a.charge)).toEqual([1, undefined, -1]);
      expect(data.atoms.map((a) => a.hydrogens)).toEqual([3, 2, undefined]);
      expect(data.atoms.map((a) => a.port)).toEqual([
        undefined,
        "$R",
        undefined,
      ]);
    } finally {
      frame.free();
    }
  });

  it("fromFrame keeps planar x/y and lays out a 3D conformer instead", () => {
    const planar = new Frame();
    const embedded = new Frame();
    try {
      for (const [frame, z] of [
        [planar, [0, 0]],
        [embedded, [0, 0.7]],
      ] as const) {
        const atoms = frame.createBlock("atoms");
        atoms.set("element", ["C", "O"]);
        atoms.set("x", new Float64Array([3, 5]));
        atoms.set("y", new Float64Array([1, 1]));
        atoms.set("z", new Float64Array(z));
      }
      const g = new MoleculeGraph();
      g.fromFrame(planar);
      expect(g.getMoleculeData().atoms.map((a) => [a.x, a.y])).toEqual([
        [3, 1],
        [5, 1],
      ]);
      g.fromFrame(embedded);
      const laidOut = g.getMoleculeData().atoms.map((a) => a.x);
      expect(laidOut).not.toEqual([3, 5]);
    } finally {
      planar.free();
      embedded.free();
    }
  });

  it("rejects negative hydrogens and empty ports transactionally", () => {
    const g = new MoleculeGraph();
    g.loadMoleculeData(H2O);
    expect(() =>
      g.loadMoleculeData({
        atoms: [{ element: "O", x: 0, y: 0, hydrogens: -1 }],
        bonds: [],
      }),
    ).toThrow(/hydrogens/);
    expect(() =>
      g.loadMoleculeData({
        atoms: [{ element: "C", x: 0, y: 0, port: " " }],
        bonds: [],
      }),
    ).toThrow(/port/);
    expect(g.getMoleculeData()).toEqual(H2O);
  });
});
