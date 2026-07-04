/**
 * GROMACS (GRO / TRR / XTC) + VASP (POSCAR) integration tests.
 *
 * These exercise the **TS integration boundary**: format inference, the
 * registry, binary/text classification, and reader dispatch in
 * `openTextReader`. Parser correctness across the full fixture set is
 * covered by the Rust-side molrs `tests/` suite; loading the large binary
 * TRR/XTC fixtures from a browser test environment is impractical (no FS
 * access), so the load assertions use minimal inlined text fixtures
 * mirroring the molrs unit-test fixtures.
 */

import { describe, expect, it } from "@rstest/core";
import {
  canStream,
  FILE_FORMAT_REGISTRY,
  getAllAcceptExtensions,
  inferFormatFromFilename,
  isBinaryFormat,
} from "../src/io/formats";
import { loadTextTrajectory } from "../src/io/reader";
import "./setup_wasm";

// Mirrors the molrs `gro.rs` `water_gro` fixture (fixed 44-column atom rows).
const WATER_GRO = `Water box
    3
    1WAT     OW    1   0.000   0.000   0.000
    1WAT    HW1    2   0.100   0.000   0.000
    1WAT    HW2    3   0.000   0.100   0.000
   2.00000   2.00000   2.00000
`;

// Mirrors the molrs `mol2.rs` `ETHANE_MIN` fixture.
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

// Mirrors the molrs `poscar.rs` `POSCAR_BN` fixture.
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

describe("GROMACS / VASP format registry", () => {
  it("registers gro, mol2, poscar, trr, xtc", () => {
    const formats = FILE_FORMAT_REGISTRY.map((d) => d.format);
    for (const f of ["gro", "mol2", "poscar", "trr", "xtc"]) {
      expect(formats).toContain(f);
    }
  });

  it("infers gro / mol2 / trr / xtc from extension", () => {
    expect(inferFormatFromFilename("conf.gro")).toBe("gro");
    expect(inferFormatFromFilename("ligand.mol2")).toBe("mol2");
    expect(inferFormatFromFilename("traj.trr")).toBe("trr");
    expect(inferFormatFromFilename("traj.xtc")).toBe("xtc");
  });

  it("infers poscar from extension and canonical POSCAR/CONTCAR basenames", () => {
    expect(inferFormatFromFilename("foo.poscar")).toBe("poscar");
    expect(inferFormatFromFilename("foo.contcar")).toBe("poscar");
    expect(inferFormatFromFilename("foo.vasp")).toBe("poscar");
    expect(inferFormatFromFilename("POSCAR")).toBe("poscar");
    expect(inferFormatFromFilename("CONTCAR")).toBe("poscar");
    expect(inferFormatFromFilename("/path/to/POSCAR")).toBe("poscar");
  });

  it("classifies trr/xtc as binary, gro/mol2/poscar as text", () => {
    expect(isBinaryFormat("trr")).toBe(true);
    expect(isBinaryFormat("xtc")).toBe(true);
    expect(isBinaryFormat("gro")).toBe(false);
    expect(isBinaryFormat("mol2")).toBe(false);
    expect(isBinaryFormat("poscar")).toBe(false);
  });

  it("marks the new formats eager-only (not streamable)", () => {
    for (const f of ["gro", "mol2", "poscar", "trr", "xtc"] as const) {
      expect(canStream(f)).toBe(false);
    }
  });

  it("includes the new extensions in the accept attribute", () => {
    const accept = getAllAcceptExtensions();
    expect(accept).toContain(".gro");
    expect(accept).toContain(".mol2");
    expect(accept).toContain(".poscar");
    expect(accept).toContain(".trr");
    expect(accept).toContain(".xtc");
  });
});

describe("loadTextTrajectory GROMACS / VASP path", () => {
  it("loads a GRO file and converts coordinates nm -> angstrom", () => {
    const bundle = loadTextTrajectory(WATER_GRO, "water.gro");
    try {
      expect(bundle.trajectory.length).toBe(1);
      const frame = bundle.trajectory.get(0);
      const atoms = frame?.getBlock("atoms");
      expect(atoms?.nrows()).toBe(3);
      const x = atoms?.copyColF("x");
      // HW1 sits at x = 0.100 nm -> 1.0 angstrom after conversion.
      expect(x?.[1]).toBeCloseTo(1.0, 6);
      expect(frame?.simbox).toBeDefined();
    } finally {
      bundle.dispose();
    }
  });

  it("loads a MOL2 file with atoms and bonds", () => {
    const bundle = loadTextTrajectory(ETHANE_MOL2, "ethane.mol2");
    try {
      expect(bundle.trajectory.length).toBe(1);
      const frame = bundle.trajectory.get(0);
      const atoms = frame?.getBlock("atoms");
      expect(atoms?.nrows()).toBe(2);
      const x = atoms?.copyColF("x");
      expect(x?.[1]).toBeCloseTo(1.5, 6);
      const bonds = frame?.getBlock("bonds");
      expect(bonds?.nrows()).toBe(1);
    } finally {
      bundle.dispose();
    }
  });

  it("loads a POSCAR file with Cartesian-angstrom coordinates", () => {
    const bundle = loadTextTrajectory(BN_POSCAR, "BN.poscar");
    try {
      expect(bundle.trajectory.length).toBe(1);
      const frame = bundle.trajectory.get(0);
      const atoms = frame?.getBlock("atoms");
      expect(atoms?.nrows()).toBe(2);
      const x = atoms?.copyColF("x");
      // (0.5,0.5,0.5) fractional in a 2.5 angstrom cube -> 1.25 angstrom.
      expect(x?.[1]).toBeCloseTo(1.25, 6);
      expect(frame?.simbox).toBeDefined();
    } finally {
      bundle.dispose();
    }
  });
});
