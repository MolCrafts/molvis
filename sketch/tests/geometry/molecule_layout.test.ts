import { describe, expect, it } from "@rstest/core";
import { MoleculeLayout } from "../../src/geometry/molecule_layout";
import type { Bond2D } from "../../src/types";

type P = { x: number; y: number };

function dist(a: P, b: P): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function minNonBonded(points: P[], bonds: Bond2D[]): number {
  const bonded = new Set(
    bonds.map((b) => `${Math.min(b.i, b.j)}-${Math.max(b.i, b.j)}`),
  );
  let min = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (bonded.has(`${i}-${j}`)) continue;
      min = Math.min(min, dist(points[i], points[j]));
    }
  }
  return min;
}

function ring(start: number, size: number, order = 1): Bond2D[] {
  return Array.from({ length: size }, (_, k) => ({
    i: start + k,
    j: start + ((k + 1) % size),
    order,
  }));
}

function chain(from: number, to: number): Bond2D[] {
  const out: Bond2D[] = [];
  for (let k = from; k < to; k++) out.push({ i: k, j: k + 1, order: 1 });
  return out;
}

/** Bonds from "i-j" (single) / "i-j=" (double) tokens. */
function parseBonds(text: string): Bond2D[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => {
      const double = token.endsWith("=");
      const [i, j] = token.replace("=", "").split("-").map(Number);
      return { i, j, order: double ? 2 : 1 };
    });
}

function segmentDistance(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Nearest approach of an atom to a bond it is not part of. */
function minAtomToBond(points: P[], bonds: Bond2D[]): number {
  let min = Infinity;
  for (const b of bonds) {
    points.forEach((p, k) => {
      if (k === b.i || k === b.j) return;
      min = Math.min(min, segmentDistance(p, points[b.i], points[b.j]));
    });
  }
  return min;
}

function crossingBonds(points: P[], bonds: Bond2D[]): number {
  const side = (a: P, b: P, c: P) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  let count = 0;
  for (let x = 0; x < bonds.length; x++) {
    for (let y = x + 1; y < bonds.length; y++) {
      const p = bonds[x];
      const q = bonds[y];
      if (p.i === q.i || p.i === q.j || p.j === q.i || p.j === q.j) continue;
      const [a, b, c, d] = [points[p.i], points[p.j], points[q.i], points[q.j]];
      if (
        side(a, b, c) * side(a, b, d) < 0 &&
        side(c, d, a) * side(c, d, b) < 0
      )
        count++;
    }
  }
  return count;
}

/**
 * PBIX-Br repeat unit, atom order of the SMILES
 * CC1(C)CC2(c3cc([<b])c([<a])cc13)CC(C)(C)c1cc(C([>b])(C(F)(F)F)c3ccc(CCCBr)cc3)c(O[>a])cc12:
 * spirobisindane (spiro atom 4) carrying a C(CF3)(4-(3-bromopropyl)phenyl)
 * centre (18). Ports: <b = 7, <a = 8, >b = 18, >a = 34.
 */
const PBIX_UNIT_ATOMS = 37;
const PBIX_UNIT_BONDS = parseBonds(`
  0-1 1-2 1-3 3-4 4-5 5-6 6-7= 7-8 8-9= 9-10 1-10 5-10= 4-11 11-12 12-13
  12-14 12-15 15-16 16-17= 17-18 18-19 19-20 19-21 19-22 18-23 23-24 24-25=
  25-26 26-27 27-28 28-29 29-30 26-31= 31-32 23-32= 17-33 33-34 33-35= 35-36
  15-36= 4-36
`);

/**
 * `count` PBIX units fused into a ladder: unit k's <b / <a atoms bond to unit
 * k+1's >b / >a atoms, closing a xanthene ring between them.
 */
function pbixLadder(count: number): { atoms: number; bonds: Bond2D[] } {
  const n = PBIX_UNIT_ATOMS;
  const bonds: Bond2D[] = [];
  for (let k = 0; k < count; k++) {
    for (const b of PBIX_UNIT_BONDS) {
      bonds.push({ i: b.i + k * n, j: b.j + k * n, order: b.order });
    }
  }
  for (let k = 0; k + 1 < count; k++) {
    bonds.push({ i: 7 + k * n, j: 18 + (k + 1) * n, order: 1 });
    bonds.push({ i: 8 + k * n, j: 34 + (k + 1) * n, order: 1 });
  }
  return { atoms: count * n, bonds };
}

/** Lays out and checks the depiction is free of overlaps. */
function expectClean(atoms: number, bonds: Bond2D[], minApproach = 0.55): P[] {
  const points = new MoleculeLayout().compute(atoms, bonds);
  for (const b of bonds)
    expect(dist(points[b.i], points[b.j])).toBeCloseTo(1, 4);
  expect(crossingBonds(points, bonds)).toBe(0);
  expect(minNonBonded(points, bonds)).toBeGreaterThan(minApproach);
  expect(minAtomToBond(points, bonds)).toBeGreaterThan(0.45);
  return points;
}

describe("MoleculeLayout", () => {
  it("draws a ring as a regular polygon with unit bonds", () => {
    const bonds = ring(0, 6);
    const points = new MoleculeLayout().compute(6, bonds);
    for (const b of bonds)
      expect(dist(points[b.i], points[b.j])).toBeCloseTo(1, 6);
    const center = {
      x: points.reduce((s, p) => s + p.x, 0) / 6,
      y: points.reduce((s, p) => s + p.y, 0) / 6,
    };
    for (const p of points) expect(dist(p, center)).toBeCloseTo(1, 6);
  });

  it("zig-zags a chain at 120 degrees and keeps it horizontal", () => {
    const bonds = chain(0, 5);
    const points = new MoleculeLayout().compute(6, bonds);
    for (const b of bonds)
      expect(dist(points[b.i], points[b.j])).toBeCloseTo(1, 6);
    // 1–3 distance of a 120° angle is sqrt(3); a trans zig-zag makes 1–4 = 2·sqrt(3)/… > 2.
    for (let k = 0; k + 2 < 6; k++) {
      expect(dist(points[k], points[k + 2])).toBeCloseTo(Math.sqrt(3), 6);
    }
    const span =
      Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const height =
      Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
    expect(span).toBeGreaterThan(height * 3);
  });

  it("lays out fused rings (naphthalene) without overlap", () => {
    const bonds: Bond2D[] = [
      ...ring(0, 6),
      ...chain(5, 9),
      { i: 9, j: 0, order: 1 },
    ];
    // second ring: 0-5 shared edge, 5-6-7-8-9-0
    const points = new MoleculeLayout().compute(10, bonds);
    for (const b of bonds)
      expect(dist(points[b.i], points[b.j])).toBeCloseTo(1, 4);
    expect(minNonBonded(points, bonds)).toBeGreaterThan(1.2);
  });

  it("places a substituted benzene (propylammonium tail) cleanly", () => {
    // c1ccc(CCC[N+](C)(C)C)cc1 as atom order from SMILES.
    const bonds: Bond2D[] = [
      { i: 0, j: 1, order: 2 },
      { i: 1, j: 2, order: 1 },
      { i: 2, j: 3, order: 2 },
      { i: 3, j: 4, order: 1 },
      { i: 4, j: 5, order: 1 },
      { i: 5, j: 6, order: 1 },
      { i: 6, j: 7, order: 1 },
      { i: 7, j: 8, order: 1 },
      { i: 7, j: 9, order: 1 },
      { i: 7, j: 10, order: 1 },
      { i: 3, j: 11, order: 1 },
      { i: 11, j: 12, order: 2 },
      { i: 12, j: 0, order: 1 },
    ];
    const points = new MoleculeLayout().compute(13, bonds);
    for (const b of bonds)
      expect(dist(points[b.i], points[b.j])).toBeCloseTo(1, 4);
    expect(minNonBonded(points, bonds)).toBeGreaterThan(1.2);
    // The quaternary N spreads its three methyls apart.
    expect(dist(points[8], points[9])).toBeGreaterThan(1.3);
    expect(dist(points[9], points[10])).toBeGreaterThan(1.3);
  });

  it("keeps sp centres linear", () => {
    // C#C-C
    const bonds: Bond2D[] = [
      { i: 0, j: 1, order: 1 },
      { i: 1, j: 2, order: 3 },
      { i: 2, j: 3, order: 1 },
    ];
    const points = new MoleculeLayout().compute(4, bonds);
    // But-2-yne: both alkyne carbons are sp, so all four atoms are collinear.
    expect(dist(points[0], points[2])).toBeCloseTo(2, 6);
    expect(dist(points[0], points[3])).toBeCloseTo(3, 6);
    expect(dist(points[1], points[3])).toBeCloseTo(2, 6);
  });

  it("sets disconnected fragments side by side", () => {
    // propane + a lone hydroxide oxygen
    const bonds = chain(0, 2);
    const points = new MoleculeLayout().compute(4, bonds);
    const fragmentRight = Math.max(points[0].x, points[1].x, points[2].x);
    expect(points[3].x).toBeGreaterThan(fragmentRight + 1);
  });

  it("place keeps provided coordinates and fills missing ones", () => {
    const layout = new MoleculeLayout();
    const kept = layout.place({
      atoms: [
        { element: "C", x: 5, y: 5 },
        { element: "O", x: 6, y: 5, charge: -1 },
      ],
      bonds: [{ i: 0, j: 1, order: 1 }],
    });
    expect(kept.atoms).toEqual([
      { element: "C", x: 5, y: 5 },
      { element: "O", x: 6, y: 5, charge: -1 },
    ]);
    const filled = layout.place({
      atoms: [{ element: "C", x: 5, y: 5 }, { element: "O" }],
      bonds: [{ i: 0, j: 1, order: 1 }],
    });
    expect(
      filled.atoms.every((a) => Number.isFinite(a.x) && Number.isFinite(a.y)),
    ).toBe(true);
    expect(dist(filled.atoms[0], filled.atoms[1])).toBeCloseTo(1, 6);
  });

  it("rejects bonds that do not fit the atom count", () => {
    expect(() =>
      new MoleculeLayout().compute(2, [{ i: 0, j: 2, order: 1 }]),
    ).toThrow(/invalid/);
    expect(() =>
      new MoleculeLayout().compute(2, [{ i: 1, j: 1, order: 1 }]),
    ).toThrow(/invalid/);
  });
});

describe("MoleculeLayout overlap resolution", () => {
  it("draws the PBIX-Br repeat unit without overlaps", () => {
    expectClean(PBIX_UNIT_ATOMS, PBIX_UNIT_BONDS);
  });

  it("draws PBIX-Br dimer and trimer ladders without overlaps", () => {
    // Fused polycyclic backbone (spiro + xanthene) with a bulky sp3 CF3/aryl
    // centre on every unit: substituents used to land on the backbone.
    for (const count of [2, 3]) {
      const { atoms, bonds } = pbixLadder(count);
      expectClean(atoms, bonds);
    }
  });

  it("opens a spiro centre along the bisector of the rings already placed", () => {
    // 1,1'-spirobisindane with gem-dimethyls; spiro atom 4.
    const bonds = parseBonds(`
      0-1 1-2 1-3 3-4 4-5 5-6 6-7 6-8 6-9 9-10 10-11= 11-12 12-13= 13-14
      9-14= 4-14 4-15 15-16 16-17= 17-18 18-19= 19-20 15-20= 1-20
    `);
    expectClean(21, bonds, 1);
  });

  it("clears a CF3 wedged between an aryl and a xanthene bay", () => {
    // FC(F)(F)C1(c2ccccc2)c2ccccc2Oc2ccccc21
    const bonds = parseBonds(`
      0-1 1-2 1-3 1-4 4-5 5-6 6-7= 7-8 8-9= 9-10 5-10= 4-11 11-12 12-13=
      13-14 14-15= 15-16 11-16= 16-17 17-18 18-19 19-20= 20-21 21-22= 22-23
      18-23= 4-23
    `);
    expectClean(24, bonds);
  });

  it("keeps neighbouring quaternary centres apart", () => {
    // CC(C)(C)CC(C)(C)CC(C)(C)C
    const bonds = parseBonds(
      "0-1 1-2 1-3 1-4 4-5 5-6 5-7 5-8 8-9 9-10 9-11 9-12",
    );
    expectClean(13, bonds, 1);
  });
});
