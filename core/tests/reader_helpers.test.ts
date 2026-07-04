import { describe, expect, it } from "@rstest/core";
import {
  describeFormat,
  FILE_FORMAT_REGISTRY,
  getAllAcceptExtensions,
  inferFormatFromFilename,
} from "../src/io/formats";

describe("inferFormatFromFilename", () => {
  it("detects PDB files across common extensions", () => {
    expect(inferFormatFromFilename("protein.pdb")).toBe("pdb");
    expect(inferFormatFromFilename("MOLECULE.PDB")).toBe("pdb");
    expect(inferFormatFromFilename("chain.ent")).toBe("pdb");
    expect(inferFormatFromFilename("legacy.brk")).toBe("pdb");
  });

  it("detects XYZ / extended-XYZ files", () => {
    expect(inferFormatFromFilename("water.xyz")).toBe("xyz");
    expect(inferFormatFromFilename("trajectory.XYZ")).toBe("xyz");
    expect(inferFormatFromFilename("props.extxyz")).toBe("xyz");
    expect(inferFormatFromFilename("props.exyz")).toBe("xyz");
  });

  it("detects CIF / mmCIF files", () => {
    expect(inferFormatFromFilename("crystal.cif")).toBe("cif");
    expect(inferFormatFromFilename("CRYSTAL.CIF")).toBe("cif");
    expect(inferFormatFromFilename("complex.mmcif")).toBe("cif");
  });

  it("detects LAMMPS data files across common extensions", () => {
    expect(inferFormatFromFilename("system.lammps")).toBe("lammps");
    expect(inferFormatFromFilename("system.lmp")).toBe("lammps");
    expect(inferFormatFromFilename("system.data")).toBe("lammps");
    expect(inferFormatFromFilename("system.lammpsdata")).toBe("lammps");
  });

  it("detects LAMMPS dump / trajectory files", () => {
    expect(inferFormatFromFilename("traj.dump")).toBe("lammps-dump");
    expect(inferFormatFromFilename("traj.lammpstrj")).toBe("lammps-dump");
    expect(inferFormatFromFilename("traj.lmptrj")).toBe("lammps-dump");
    expect(inferFormatFromFilename("traj.lammpsdump")).toBe("lammps-dump");
  });

  it("returns null for unknown extensions rather than guessing", () => {
    expect(inferFormatFromFilename("file.unknown")).toBeNull();
    expect(inferFormatFromFilename("file.bogus")).toBeNull();
    expect(inferFormatFromFilename("noextension")).toBeNull();
  });

  it("handles files with spaces and multiple dots", () => {
    expect(inferFormatFromFilename("my file.v2.pdb")).toBe("pdb");
    expect(inferFormatFromFilename("  trajectory.xyz  ")).toBe("xyz");
  });

  it("returns null for empty input", () => {
    expect(inferFormatFromFilename("")).toBeNull();
  });
});

describe("getAllAcceptExtensions", () => {
  it("emits a dotted comma-separated list of every registered extension", () => {
    const result = getAllAcceptExtensions();
    const parts = result.split(",");
    for (const entry of FILE_FORMAT_REGISTRY) {
      for (const ext of entry.extensions) {
        expect(parts).toContain(`.${ext}`);
      }
    }
  });

  it("does not double-count extensions", () => {
    const parts = getAllAcceptExtensions().split(",");
    expect(new Set(parts).size).toBe(parts.length);
  });
});

describe("describeFormat", () => {
  it("returns the descriptor for every canonical format", () => {
    for (const entry of FILE_FORMAT_REGISTRY) {
      expect(describeFormat(entry.format)).toBe(entry);
    }
  });
});
