import * as molrs from "@molcrafts/molvis-core/molrs";
import {
  LammpsDataStream,
  LammpsDumpStream,
  MrecReader,
  PdbStream,
  readEncodedFrame,
  SdfStream,
  wasmMemory,
  writeEncodedFrame,
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

describe("parseRangeInInput", () => {
  it("returns the decoded Frame, which survives molrs bytes", () => {
    const bytes = new TextEncoder().encode(
      [
        "3",
        'Lattice="10 0 0 0 12 0 0 0 14" Properties=species:S:1:pos:R:3',
        "O 0.0 0.0 0.0",
        "H 0.5 1.0 0.0",
        "H -0.5 1.0 0.0",
        "",
      ].join("\n"),
    );
    const stream = new XyzStream();
    const ptr = stream.allocInputBuffer(bytes.byteLength);
    new Uint8Array(wasmMemory().buffer, ptr, bytes.byteLength).set(bytes);
    const frame = stream.parseRangeInInput(0, bytes.byteLength);
    stream.free();

    // What the worker posts and the main thread reads back.
    const back = readEncodedFrame(
      writeEncodedFrame(frame, "msgpack"),
      "msgpack",
    );
    frame.free();
    const atoms = back.get("atoms");
    expect(atoms?.nRows).toBe(3);
    expect(Array.from((atoms?.copy("x") ?? []) as Float64Array)).toEqual([
      0, 0.5, -0.5,
    ]);
    // molrs 0.16 maps `Properties=species:S:1` onto canonical `element`.
    expect([...(atoms?.copy("element") as string[])]).toEqual(["O", "H", "H"]);
    const h = back.box?.h().toCopy();
    expect([h?.[0], h?.[4], h?.[8]]).toEqual([10, 12, 14]);
    back.free();
  });

  it("throws on a range past the input buffer", () => {
    const stream = new XyzStream();
    stream.allocInputBuffer(8);
    expect(() => stream.parseRangeInInput(4, 100)).toThrow();
    stream.free();
  });
});
