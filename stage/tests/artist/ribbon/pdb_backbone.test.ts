import { describe, expect, it } from "@rstest/core";
import {
  getSecondaryStructure,
  parsePdbBackbone,
} from "../../../src/artist/ribbon/pdb_backbone";

const MINI_PDB = `\
HELIX    1   1 ALA A    1  ALA A    5  1                                   5
SHEET    1   A 1 GLY A   8  GLY A  10  0
ATOM      1  N   ALA A   1       1.000   2.000   3.000  1.00 10.00           N
ATOM      2  CA  ALA A   1       1.500   2.500   3.500  1.00 10.00           C
ATOM      3  C   ALA A   1       2.000   3.000   4.000  1.00 10.00           C
ATOM      4  O   ALA A   1       2.500   3.500   4.500  1.00 10.00           O
ATOM      5  N   ALA A   2       3.000   4.000   5.000  1.00 10.00           N
ATOM      6  CA  ALA A   2       3.500   4.500   5.500  1.00 10.00           C
ATOM      7  C   ALA A   2       4.000   5.000   6.000  1.00 10.00           C
ATOM      8  O   ALA A   2       4.500   5.500   6.500  1.00 10.00           O
ATOM      9  N   ALA A   3       5.000   6.000   7.000  1.00 10.00           N
ATOM     10  CA  ALA A   3       5.500   6.500   7.500  1.00 10.00           C
ATOM     11  C   ALA A   3       6.000   7.000   8.000  1.00 10.00           C
ATOM     12  O   ALA A   3       6.500   7.500   8.500  1.00 10.00           O
END`;

describe("parsePdbBackbone", () => {
  it("should extract chain traces with CA atoms", () => {
    const chains = parsePdbBackbone(MINI_PDB);
    expect(chains.length).toBe(1);
    expect(chains[0].chainId).toBe("A");
    expect(chains[0].residues.length).toBe(3);
  });

  it("should parse CA coordinates correctly", () => {
    const chains = parsePdbBackbone(MINI_PDB);
    const res1 = chains[0].residues[0];
    expect(res1.ca).not.toBeUndefined();
    expect(res1.ca?.x).toBeCloseTo(1.5, 3);
    expect(res1.ca?.y).toBeCloseTo(2.5, 3);
    expect(res1.ca?.z).toBeCloseTo(3.5, 3);
  });

  it("should assign backbone atoms (N, CA, C, O)", () => {
    const chains = parsePdbBackbone(MINI_PDB);
    const res1 = chains[0].residues[0];
    expect(res1.n).not.toBeUndefined();
    expect(res1.ca).not.toBeUndefined();
    expect(res1.c).not.toBeUndefined();
    expect(res1.o).not.toBeUndefined();
  });

  it("should assign HELIX secondary structure", () => {
    const chains = parsePdbBackbone(MINI_PDB);
    // Residues 1-3 are within HELIX range 1-5
    for (const res of chains[0].residues) {
      expect(res.ss).toBe("helix");
    }
  });

  it("should sort residues by resSeq", () => {
    const chains = parsePdbBackbone(MINI_PDB);
    const seqs = chains[0].residues.map((r) => r.resSeq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("should return empty array for empty input", () => {
    expect(parsePdbBackbone("").length).toBe(0);
  });

  it("should require at least 2 CA atoms per chain", () => {
    const singleResidue = `\
ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 10.00           C
END`;
    const chains = parsePdbBackbone(singleResidue);
    expect(chains.length).toBe(0);
  });

  it("should skip non-backbone atoms", () => {
    const withSidechain = `\
ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 10.00           C
ATOM      2  CB  ALA A   1       1.100   2.100   3.100  1.00 10.00           C
ATOM      3  CA  ALA A   2       2.000   3.000   4.000  1.00 10.00           C
END`;
    const chains = parsePdbBackbone(withSidechain);
    expect(chains.length).toBe(1);
    expect(chains[0].residues.length).toBe(2);
  });
});

describe("getSecondaryStructure", () => {
  const ranges = [
    { type: "helix" as const, chainId: "A", startResSeq: 1, endResSeq: 5 },
    { type: "sheet" as const, chainId: "A", startResSeq: 8, endResSeq: 10 },
  ];

  it("should return helix for residues in HELIX range", () => {
    expect(getSecondaryStructure(ranges, "A", 3)).toBe("helix");
  });

  it("should return sheet for residues in SHEET range", () => {
    expect(getSecondaryStructure(ranges, "A", 9)).toBe("sheet");
  });

  it("should return coil for residues outside any range", () => {
    expect(getSecondaryStructure(ranges, "A", 6)).toBe("coil");
  });

  it("should return coil for wrong chain", () => {
    expect(getSecondaryStructure(ranges, "B", 3)).toBe("coil");
  });
});
