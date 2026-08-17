import { describe, expect, it } from "@rstest/core";
import { extractMessage, toIoError } from "../../src/io/load_error";
import { loadTextTrajectory } from "../../src/io/reader";
import "../setup_wasm";

describe("toIoError", () => {
  it("keeps raw string throws from wasm-bindgen (molrs style)", () => {
    const err = toIoError("LAMMPS read error: expected Atoms section", "open");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("LAMMPS read error");
    expect(err.message).toContain("open");
  });

  it("preserves Error messages", () => {
    const err = toIoError(new Error("line 42: bad token"), "LAMMPS Data index");
    expect(err.message).toBe("LAMMPS Data index: line 42: bad token");
  });

  it("does not double-wrap the same context", () => {
    const inner = new Error("LAMMPS Data (lammps) index: boom");
    const err = toIoError(inner, "LAMMPS Data (lammps) index");
    expect(err.message).toBe("LAMMPS Data (lammps) index: boom");
  });
});

describe("loadTextTrajectory error surfacing", () => {
  it("rejects junk content selected as LAMMPS Data with a clear message", async () => {
    // molrs may construct a reader with len=1 and an empty frame; we must
    // still refuse to treat that as a successful structure load.
    const junk = "this is not a lammps data file\njust garbage\n";
    const { trajectory, dispose } = loadTextTrajectory(
      junk,
      "PE_equil.out",
      "lammps",
    );
    try {
      await expect(trajectory.frame(0)).rejects.toThrow(
        /0 atoms|not valid|LAMMPS Data|Atoms/i,
      );
    } finally {
      dispose();
    }
  });

  it("rejects dump content forced through LAMMPS Data with format hint", async () => {
    const dump = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS pp pp pp
0 10
0 10
0 10
ITEM: ATOMS id type x y z
1 1 0 0 0
2 1 1 0 0
`;
    const { trajectory, dispose } = loadTextTrajectory(
      dump,
      "traj.out",
      "lammps",
    );
    try {
      await expect(trajectory.frame(0)).rejects.toThrow(/0 atoms|Dump|data/i);
    } finally {
      dispose();
    }
  });

  it("loads a minimal valid LAMMPS data file", async () => {
    const data = `LAMMPS data file via molvis test

2 atoms
1 atom types

0.0 10.0 xlo xhi
0.0 10.0 ylo yhi
0.0 10.0 zlo zhi

Masses

1 12.0

Atoms # atomic

1 1 1.0 2.0 3.0
2 1 4.0 5.0 6.0
`;
    const { trajectory, dispose } = loadTextTrajectory(
      data,
      "ok.data",
      "lammps",
    );
    try {
      const frame = await trajectory.frame(0);
      expect(frame.getBlock("atoms")?.nrows()).toBe(2);
    } finally {
      dispose();
    }
  });

  it("extractMessage handles string throws", () => {
    expect(extractMessage("LAMMPS read error: boom")).toBe(
      "LAMMPS read error: boom",
    );
  });
});
