import { describe, expect, it } from "@rstest/core";
import type { Residue } from "../src/artist/ribbon/pdb_backbone";
import { assignSecondaryStructure } from "../src/artist/ribbon/secondary_structure";

/**
 * Build a Residue array from CA coordinates only — `o` and other
 * backbone atoms aren't needed by the SS classifier (it's CA-driven).
 */
function rowsFromCA(
  coords: ReadonlyArray<[number, number, number]>,
): Residue[] {
  return coords.map((c, i) => ({
    chainId: "A",
    resSeq: i + 1,
    resName: "ALA",
    ca: {
      x: c[0],
      y: c[1],
      z: c[2],
      atomName: "CA",
      resName: "ALA",
      chainId: "A",
      resSeq: i + 1,
    },
    c: undefined,
    n: undefined,
    o: undefined,
    ss: "coil",
  }));
}

/**
 * Generate Cα positions for an idealised right-handed α helix.
 * Rise per residue = 1.5 Å, radius = 2.3 Å, 3.6 residues / turn.
 */
function idealAlphaHelixCAs(n: number): Array<[number, number, number]> {
  const rise = 1.5;
  const radius = 2.3;
  const dphi = (2 * Math.PI) / 3.6;
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const phi = i * dphi;
    out.push([radius * Math.cos(phi), radius * Math.sin(phi), i * rise]);
  }
  return out;
}

/**
 * Generate Cα positions for an idealised extended β strand.
 * Real geometry: Cα-Cα ≈ 3.8 Å, bond angle θ ≈ 125°. With those
 * constraints the zig-zag stride along the strand axis is
 * 3.8·sin(62.5°) ≈ 3.37 Å and the amplitude is 3.8·cos(62.5°) ≈ 1.76 Å.
 * All points coplanar so virtual torsion is exactly ±180°.
 */
function idealBetaStrandCAs(n: number): Array<[number, number, number]> {
  const stride = 3.37;
  const amp = 1.76;
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    out.push([i * stride, (i % 2) * amp, 0]);
  }
  return out;
}

describe("assignSecondaryStructure", () => {
  it("classifies an idealised α helix as helix in the interior", () => {
    const rows = rowsFromCA(idealAlphaHelixCAs(12));
    assignSecondaryStructure(rows);

    // Boundary residues (first 1, last 2) stay coil because the
    // window can't be completed; the inner residues should be helix.
    const interior = rows.slice(2, 9).map((r) => r.ss);
    expect(interior.every((s) => s === "helix")).toBe(true);
  });

  it("classifies an extended β strand as sheet in the interior", () => {
    const rows = rowsFromCA(idealBetaStrandCAs(8));
    assignSecondaryStructure(rows);
    const interior = rows.slice(2, 6).map((r) => r.ss);
    expect(interior.every((s) => s === "sheet")).toBe(true);
  });

  it("demotes single-residue helix noise to coil (run < MIN_HELIX_RUN)", () => {
    // 3 helical CAs surrounded by extended geometry — too short to
    // count as helix.
    const helix3 = idealAlphaHelixCAs(3);
    const strand = idealBetaStrandCAs(3).map(
      ([x, y, z]) => [x + 100, y, z] as [number, number, number],
    );
    const rows = rowsFromCA([...strand, ...helix3, ...strand]);
    assignSecondaryStructure(rows);
    // No row should be marked helix.
    expect(rows.find((r) => r.ss === "helix")).toBeUndefined();
  });

  it("does not extend SS runs across chain boundaries", () => {
    // Two short helices, one per chain — each below MIN_HELIX_RUN
    // when considered alone, so neither should survive the smoothing.
    const half = idealAlphaHelixCAs(3);
    const rows: Residue[] = [];
    for (let i = 0; i < half.length; i++) {
      const c = half[i];
      rows.push({
        chainId: "A",
        resSeq: i + 1,
        resName: "ALA",
        ca: {
          x: c[0],
          y: c[1],
          z: c[2],
          atomName: "CA",
          resName: "ALA",
          chainId: "A",
          resSeq: i + 1,
        },
        c: undefined,
        n: undefined,
        o: undefined,
        ss: "coil",
      });
    }
    for (let i = 0; i < half.length; i++) {
      const c = half[i];
      rows.push({
        chainId: "B",
        resSeq: i + 1,
        resName: "ALA",
        ca: {
          x: c[0] + 50,
          y: c[1],
          z: c[2],
          atomName: "CA",
          resName: "ALA",
          chainId: "B",
          resSeq: i + 1,
        },
        c: undefined,
        n: undefined,
        o: undefined,
        ss: "coil",
      });
    }
    assignSecondaryStructure(rows);
    expect(rows.every((r) => r.ss === "coil")).toBe(true);
  });
});
