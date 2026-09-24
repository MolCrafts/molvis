import { describe, expect, it } from "@rstest/core";
import { viewAtomCoords } from "../../src/io/atom_coords";
import { loadTextTrajectory } from "../../src/io/reader";
import "../setup_wasm";

const XYZ_TRAJECTORY_FIXTURE = `2
frame 0
H 0.0 0.0 0.0
He 1.0 0.0 0.0
2
frame 1
H 2.0 0.0 0.0
He 3.0 0.0 0.0
`;

// Blank lines between frames / trailing blanks are common from ASE and
// some MD exporters. molrs XYZReader::len() used to throw
// "XYZ len error: invalid atom count:" on these files.
const XYZ_TRAJECTORY_WITH_BLANKS = `2
frame 0
H 0.0 0.0 0.0
He 1.0 0.0 0.0

2
frame 1
H 2.0 0.0 0.0
He 3.0 0.0 0.0

`;

// Extended-XYZ declares its element column via the `Properties=` header. With
// `species:S:1` the molrs reader emits a `species` column, not `element`; the
// reader must normalize it so per-element coloring / bonds / RDF still work.
const EXTXYZ_SPECIES_FIXTURE = `3
Lattice="10 0 0 0 10 0 0 0 10" Properties=species:S:1:pos:R:3 frame 0
C 0.0 0.0 0.0
H 1.0 0.0 0.0
O 0.0 1.0 0.0
`;

const XYZ_CONNCT_FIXTURE = `3
name=water Connct="[0,1,0,2]"
O 0.0 0.0 0.0
H 1.0 0.0 0.0
H 0.0 1.0 0.0
`;

// LAMMPS `dump local` bond overlay as written by molrs
// `write_lammps_dump_local`: `ITEM: ENTRIES batom1 batom2 [btype]` and no
// atoms block. The endpoints are 1-based atom ids, not row indices.
const DUMP_LOCAL_BONDS_FIXTURE = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ENTRIES
2
ITEM: BOX BOUNDS pp pp pp
0.0 10.0
0.0 10.0
0.0 10.0
ITEM: ENTRIES batom1 batom2 btype
1 2 1
2 3 1
`;

describe("loadTextTrajectory", () => {
  it("opens xyz content lazily as a trajectory", () => {
    const bundle = loadTextTrajectory(XYZ_TRAJECTORY_FIXTURE, "traj.xyz");

    try {
      expect(bundle.trajectory.length).toBe(2);

      const firstAtoms = bundle.trajectory.get(0)?.getBlock("atoms");
      const secondAtoms = bundle.trajectory.get(1)?.getBlock("atoms");
      const firstCoords = firstAtoms ? viewAtomCoords(firstAtoms) : undefined;
      const secondCoords = secondAtoms
        ? viewAtomCoords(secondAtoms)
        : undefined;

      expect(firstCoords?.x[0]).toBe(0);
      expect(firstCoords?.x[1]).toBe(1);
      expect(secondCoords?.x[0]).toBe(2);
      expect(secondCoords?.x[1]).toBe(3);
    } finally {
      bundle.dispose();
    }
  });

  it("opens multi-frame xyz with inter-frame and trailing blank lines", () => {
    const bundle = loadTextTrajectory(XYZ_TRAJECTORY_WITH_BLANKS, "traj.xyz");

    try {
      expect(bundle.trajectory.length).toBe(2);
      const firstCoords = viewAtomCoords(
        bundle.trajectory.get(0)!.getBlock("atoms")!,
      );
      const secondCoords = viewAtomCoords(
        bundle.trajectory.get(1)!.getBlock("atoms")!,
      );
      expect(firstCoords?.x[0]).toBe(0);
      expect(secondCoords?.x[0]).toBe(2);
    } finally {
      bundle.dispose();
    }
  });

  it("normalizes the extended-XYZ `species` column to canonical `element`", () => {
    const bundle = loadTextTrajectory(EXTXYZ_SPECIES_FIXTURE, "traj.xyz");

    try {
      const atoms = bundle.trajectory.get(0)?.getBlock("atoms");
      expect(atoms?.dtype("element")).toBe("string");
      expect([...(atoms?.copyColStr("element") ?? [])]).toEqual([
        "C",
        "H",
        "O",
      ]);
    } finally {
      bundle.dispose();
    }
  });

  it("loads zero-based Connct pairs as canonical bonds", () => {
    const bundle = loadTextTrajectory(XYZ_CONNCT_FIXTURE, "water.xyz");

    try {
      const bonds = bundle.trajectory.get(0)?.getBlock("bonds");
      expect(bonds?.nrows()).toBe(2);
      expect(Array.from(bonds?.copyColU32("atomi") ?? [], Number)).toEqual([
        0, 0,
      ]);
      expect(Array.from(bonds?.copyColU32("atomj") ?? [], Number)).toEqual([
        1, 2,
      ]);
    } finally {
      bundle.dispose();
    }
  });

  it("maps LAMMPS Atom Type Labels onto element so hydrogen is not a full-size sphere", () => {
    const data = `# labels
3 atoms
2 bonds
3 atom types
1 bond types

0.0 10.0 xlo xhi
0.0 10.0 ylo yhi
0.0 10.0 zlo zhi

Atom Type Labels

1 C
2 H
3 O

Masses

1 12.0
2 1.008
3 16.0

Atoms # full

1 1 3 0.0 0.0 0.0 0.0
2 1 1 0.0 1.4 0.0 0.0
3 1 2 0.0 2.1 0.9 0.0

Bonds

1 1 1 2
2 1 2 3
`;
    const bundle = loadTextTrajectory(data, "labeled.data");
    try {
      const frame = bundle.trajectory.get(0);
      const atoms = frame?.getBlock("atoms");
      expect(atoms?.getStr("element")).toEqual(["O", "C", "H"]);
      const bonds = frame?.getBlock("bonds");
      expect(Array.from(bonds?.copyColU32("atomi") ?? [], Number)).toEqual([
        0, 1,
      ]);
      expect(Array.from(bonds?.copyColU32("atomj") ?? [], Number)).toEqual([
        1, 2,
      ]);
    } finally {
      bundle.dispose();
    }
  });

  it("leaves force-field Atom Type Labels on type_id", () => {
    const data = `# ff labels
1 atoms
1 atom types

0.0 10.0 xlo xhi
0.0 10.0 ylo yhi
0.0 10.0 zlo zhi

Atom Type Labels

1 CT

Masses

1 12.0

Atoms # full

1 1 1 0.0 0.0 0.0 0.0
`;
    const bundle = loadTextTrajectory(data, "ff.data");
    try {
      const atoms = bundle.trajectory.get(0)?.getBlock("atoms");
      expect(atoms?.dtype("element")).toBeUndefined();
      expect(Number(atoms?.viewColU32("type_id")?.[0])).toBe(1);
    } finally {
      bundle.dispose();
    }
  });

  it("opens a bond-only .dump.local overlay and renames entries to bonds", () => {
    const bundle = loadTextTrajectory(
      DUMP_LOCAL_BONDS_FIXTURE,
      "bonds.dump.local",
    );

    try {
      const frame = bundle.trajectory.get(0);
      expect(frame?.getBlock("entries")).toBeUndefined();
      const bonds = frame?.getBlock("bonds");
      expect(bonds?.nrows()).toBe(2);
      expect(bonds?.dtype("batom1")).toBeDefined();
      expect(bonds?.dtype("batom2")).toBeDefined();
      expect(bonds?.dtype("btype")).toBeDefined();
      // A bond-only overlay must not trip the "frame has 0 atoms" guard.
      expect(frame?.getBlock("atoms")).toBeUndefined();
    } finally {
      bundle.dispose();
    }
  });
});
