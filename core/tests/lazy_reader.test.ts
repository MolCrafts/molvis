import { describe, expect, it } from "@rstest/core";
import { viewAtomCoords } from "../src/io/atom_coords";
import { loadTextTrajectory } from "../src/io/reader";
import "./setup_wasm";

const XYZ_TRAJECTORY_FIXTURE = `2
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
});
