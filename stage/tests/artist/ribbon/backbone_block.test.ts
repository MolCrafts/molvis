import { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  RESIDUES_BLOCK,
  readBackboneBlock,
  writeBackboneBlock,
} from "../../../src/artist/ribbon/backbone_block";

const MINI_PDB = `\
HELIX    1   1 ALA A    1  ALA A    5  1                                   5
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

describe("writeBackboneBlock / readBackboneBlock", () => {
  it("round-trips CA positions, chain id, and SS through a frame block", () => {
    const frame = new Frame();
    writeBackboneBlock(frame, MINI_PDB);

    const block = frame.getBlock(RESIDUES_BLOCK);
    expect(block).toBeDefined();
    expect(block?.nrows()).toBe(3);

    const chains = readBackboneBlock(frame);
    expect(chains.length).toBe(1);
    expect(chains[0].chainId).toBe("A");
    expect(chains[0].residues.length).toBe(3);

    const first = chains[0].residues[0];
    expect(first.ca?.x).toBeCloseTo(1.5, 3);
    expect(first.ca?.y).toBeCloseTo(2.5, 3);
    expect(first.ca?.z).toBeCloseTo(3.5, 3);
    expect(first.o?.x).toBeCloseTo(2.5, 3);
    expect(first.ss).toBe("helix");

    frame.free();
  });

  it("is a no-op when the PDB has no CA atoms", () => {
    const frame = new Frame();
    writeBackboneBlock(frame, "END\n");
    expect(frame.getBlock(RESIDUES_BLOCK)).toBeUndefined();
    expect(readBackboneBlock(frame)).toEqual([]);
    frame.free();
  });

  it("returns [] for a frame with no residues block", () => {
    const frame = new Frame();
    expect(readBackboneBlock(frame)).toEqual([]);
    frame.free();
  });

  it("marks missing O atoms as NaN and reconstructs them as undefined", () => {
    const noOxygen = `\
ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 10.00           C
ATOM      2  CA  ALA A   2       2.000   3.000   4.000  1.00 10.00           C
END`;
    const frame = new Frame();
    writeBackboneBlock(frame, noOxygen);
    const chains = readBackboneBlock(frame);
    expect(chains.length).toBe(1);
    expect(chains[0].residues[0].o).toBeUndefined();
    frame.free();
  });
});
