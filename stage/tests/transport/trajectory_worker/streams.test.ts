import * as molrs from "@molcrafts/molvis-core/molrs";
import {
  LammpsDataStream,
  LammpsDumpStream,
  MrecReader,
  PdbStream,
  SdfStream,
  XyzStream,
} from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  isStoreFormat,
  MOLRS_STORE_READERS,
  MOLRS_TRAJ_STREAMS,
} from "../../../src/transport/trajectory_worker/streams";

describe("MOLRS_TRAJ_STREAMS", () => {
  it("maps every worker Format to a molrs stream constructor", () => {
    expect(MOLRS_TRAJ_STREAMS["lammps-dump"]).toBe(LammpsDumpStream);
    expect(MOLRS_TRAJ_STREAMS.xyz).toBe(XyzStream);
    expect(MOLRS_TRAJ_STREAMS.pdb).toBe(PdbStream);
    expect(MOLRS_TRAJ_STREAMS.lammps).toBe(LammpsDataStream);
    expect(MOLRS_TRAJ_STREAMS.sdf).toBe(SdfStream);
    expect(Object.hasOwn(MOLRS_TRAJ_STREAMS, "dcd")).toBe(true);
    expect(Object.hasOwn(MOLRS_TRAJ_STREAMS, "xtc")).toBe(true);
    expect(Object.hasOwn(MOLRS_TRAJ_STREAMS, "trr")).toBe(true);
  });

  it("uses the molrs export for DCD/XTC/TRR when that package ships them", () => {
    for (const [format, name] of [
      ["dcd", "DcdStream"],
      ["xtc", "XtcStream"],
      ["trr", "TrrStream"],
    ] as const) {
      const shipped = (molrs as Record<string, unknown>)[name];
      if (typeof shipped === "function") {
        expect(MOLRS_TRAJ_STREAMS[format]).toBe(shipped);
      }
    }
  });
});

describe("MOLRS_STORE_READERS", () => {
  it("routes the mrec store format to molrs MrecReader", () => {
    expect(MOLRS_STORE_READERS.mrec).toBe(MrecReader);
    expect(isStoreFormat("mrec")).toBe(true);
    expect(isStoreFormat("xyz")).toBe(false);
    // No byte stream exists for a store format.
    expect(Object.hasOwn(MOLRS_TRAJ_STREAMS, "mrec")).toBe(false);
  });
});
