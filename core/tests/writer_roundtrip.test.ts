/**
 * Writer round-trip tests: every molrs writer exposed through molvis.
 *
 * Loads a small inline fixture, writes it back via `writeFrame`, re-reads the
 * payload, and checks coordinates survive — exercising the WASM writers
 * (text `writeFrame` + binary `writeFrameBytes`) and the bidirectional
 * nm<->angstrom scaling for the GROMACS formats. Parser/writer correctness on
 * the full fixture set is covered Rust-side; this guards the TS boundary.
 */

import { describe, expect, it } from "@rstest/core";
import { loadBinaryTrajectory, loadTextTrajectory } from "../src/io/reader";
import { writableFormats, writeFrame } from "../src/io/writer";
import "./setup_wasm";

const WATER_GRO = `Water box
    3
    1WAT     OW    1   0.000   0.000   0.000
    1WAT    HW1    2   0.100   0.000   0.000
    1WAT    HW2    3   0.000   0.100   0.000
   2.00000   2.00000   2.00000
`;

const ETHANE_MOL2 = `@<TRIPOS>MOLECULE
ETH
2 1 1 0 0
SMALL
NO_CHARGES
@<TRIPOS>ATOM
1 C1 0.0 0.0 0.0 c3 1 ETH 0.0
2 C2 1.5 0.0 0.0 c3 1 ETH 0.0
@<TRIPOS>BOND
1 1 2 1
`;

const BN_POSCAR = `BN bulk
1.0
2.5  0.0  0.0
0.0  2.5  0.0
0.0  0.0  2.5
B N
1 1
Direct
0.0 0.0 0.0
0.5 0.5 0.5
`;

/** Load src → write `format` → re-read → return atoms.x of the re-read frame. */
function roundTripX(
  src: string,
  srcName: string,
  format: string,
  ext: string,
  binary: boolean,
): { x: Float64Array | undefined; nAtoms: number; nBonds: number } {
  const a = loadTextTrajectory(src, srcName);
  try {
    const frame = a.trajectory.get(0);
    if (!frame) throw new Error("no source frame");
    const payload = writeFrame(frame, { format, filename: `out.${ext}` });
    const b = binary
      ? loadBinaryTrajectory(payload.content as Uint8Array, `out.${ext}`)
      : loadTextTrajectory(payload.content as string, `out.${ext}`);
    try {
      const atoms = b.trajectory.get(0)?.getBlock("atoms");
      return {
        x: atoms?.copyColF("x"),
        nAtoms: atoms?.nrows() ?? 0,
        nBonds: b.trajectory.get(0)?.getBlock("bonds")?.nrows() ?? 0,
      };
    } finally {
      b.dispose();
    }
  } finally {
    a.dispose();
  }
}

describe("writer registry", () => {
  it("writableFormats covers every molrs writer and excludes read-only formats", () => {
    const w = writableFormats();
    for (const f of [
      "pdb",
      "xyz",
      "cif",
      "cube",
      "gro",
      "mol2",
      "poscar",
      "lammps",
      "lammps-dump",
      "dcd",
      "trr",
      "xtc",
    ]) {
      expect(w).toContain(f);
    }
    // molrs has no SDF or CHGCAR writer.
    expect(w).not.toContain("sdf");
    expect(w).not.toContain("chgcar");
  });
});

describe("text writer round-trips", () => {
  it("GRO survives the angstrom -> nm -> angstrom round-trip", () => {
    const { x, nAtoms } = roundTripX(WATER_GRO, "in.gro", "gro", "gro", false);
    expect(nAtoms).toBe(3);
    expect(x?.[1]).toBeCloseTo(1.0, 4); // 0.100 nm -> 1.0 Å, both ways
  });

  it("MOL2 preserves coordinates and bonds", () => {
    const { x, nAtoms, nBonds } = roundTripX(
      ETHANE_MOL2,
      "in.mol2",
      "mol2",
      "mol2",
      false,
    );
    expect(nAtoms).toBe(2);
    expect(nBonds).toBe(1);
    expect(x?.[1]).toBeCloseTo(1.5, 4);
  });

  it("POSCAR preserves Cartesian-angstrom coordinates", () => {
    const { x, nAtoms } = roundTripX(
      BN_POSCAR,
      "in.poscar",
      "poscar",
      "poscar",
      false,
    );
    expect(nAtoms).toBe(2);
    expect(x?.[1]).toBeCloseTo(1.25, 4);
  });

  it("can also emit XYZ, PDB and CIF for the same frame", () => {
    for (const [format, ext] of [
      ["xyz", "xyz"],
      ["pdb", "pdb"],
      ["cif", "cif"],
    ] as const) {
      const { nAtoms } = roundTripX(WATER_GRO, "in.gro", format, ext, false);
      expect(nAtoms).toBe(3);
    }
  });
});

describe("binary writer round-trips", () => {
  it("TRR re-reads to the same coordinates (full precision)", () => {
    const { x, nAtoms } = roundTripX(WATER_GRO, "in.gro", "trr", "trr", true);
    expect(nAtoms).toBe(3);
    expect(x?.[1]).toBeCloseTo(1.0, 3);
  });

  it("DCD re-reads to the right atom count and coordinates", () => {
    const { x, nAtoms } = roundTripX(WATER_GRO, "in.gro", "dcd", "dcd", true);
    expect(nAtoms).toBe(3);
    expect(x?.[1]).toBeCloseTo(1.0, 2);
  });

  it("XTC re-reads within compression tolerance", () => {
    const { x, nAtoms } = roundTripX(WATER_GRO, "in.gro", "xtc", "xtc", true);
    expect(nAtoms).toBe(3);
    expect(x?.[1]).toBeCloseTo(1.0, 1);
  });
});
