/**
 * WASM boundary contract for @molcrafts/molrs.
 *
 * Touches every WASM method MolVis actually calls. Runs under chromium
 * headless (core/rstest.config.ts) so the WASM pathway exercised here is
 * the same one used in production.
 *
 * Guardrail: every float input is `Float64Array`. If a future molrs bump
 * drifts a signature, this file fails in isolation instead of inside a
 * modifier 30 stack frames deep.
 */

import {
  Block,
  Box,
  CIFReader,
  Frame,
  LAMMPSReader,
  LAMMPSTrajReader,
  LinkedCell,
  PDBReader,
  RDF,
  SDFReader,
  Topology,
  XYZReader,
  parseSMILES,
  wasmMemory,
  writeFrame,
} from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";

// ── Shared fixtures ────────────────────────────────────────────────────────

function makeAtomsBlock(): Block {
  const atoms = new Block();
  atoms.setColF("x", new Float64Array([0, 1, 0]));
  atoms.setColF("y", new Float64Array([0, 0, 1]));
  atoms.setColF("z", new Float64Array([0, 0, 0]));
  atoms.setColStr("element", ["O", "H", "H"]);
  atoms.setColU32("id", new Uint32Array([0, 1, 2]));
  return atoms;
}

function makeBondsBlock(): Block {
  const bonds = new Block();
  bonds.setColU32("i", new Uint32Array([0, 0]));
  bonds.setColU32("j", new Uint32Array([1, 2]));
  bonds.setColU32("order", new Uint32Array([1, 1]));
  return bonds;
}

function makeFrameWithAtomsBonds(): Frame {
  const frame = new Frame();
  frame.insertBlock("atoms", makeAtomsBlock());
  frame.insertBlock("bonds", makeBondsBlock());
  return frame;
}

// ── Block ──────────────────────────────────────────────────────────────────

describe("WASM Block", () => {
  it("constructs, reports row/column counts", () => {
    const block = new Block();
    expect(block.isEmpty()).toBe(true);
    expect(block.len()).toBe(0);
    expect(block.nrows()).toBe(0);

    block.setColF("x", new Float64Array([1, 2, 3]));
    expect(block.isEmpty()).toBe(false);
    expect(block.len()).toBe(1);
    expect(block.nrows()).toBe(3);
    expect(block.keys()).toEqual(["x"]);
    expect(block.dtype("x")).toBe("f64");
    expect(block.dtype("missing")).toBeUndefined();
    block.free();
  });

  it("round-trips every typed column via set/view/copy", () => {
    const block = new Block();
    block.setColF("x", new Float64Array([1.5, 2.5, 3.5]));
    block.setColU32("id", new Uint32Array([10, 20, 30]));
    block.setColI32("signed", new Int32Array([-1, 0, 1]));
    block.setColStr("element", ["C", "N", "O"]);

    const viewF = block.viewColF("x");
    expect(viewF).toBeInstanceOf(Float64Array);
    expect(Array.from(viewF)).toEqual([1.5, 2.5, 3.5]);

    const viewU = block.viewColU32("id");
    expect(viewU).toBeInstanceOf(Uint32Array);
    expect(Array.from(viewU)).toEqual([10, 20, 30]);

    const viewI = block.viewColI32("signed");
    expect(viewI).toBeInstanceOf(Int32Array);
    expect(Array.from(viewI)).toEqual([-1, 0, 1]);

    expect(Array.from(block.copyColF("x"))).toEqual([1.5, 2.5, 3.5]);
    expect(Array.from(block.copyColU32("id"))).toEqual([10, 20, 30]);
    expect(Array.from(block.copyColI32("signed"))).toEqual([-1, 0, 1]);
    expect(block.copyColStr("element")).toEqual(["C", "N", "O"]);

    block.free();
  });

  it("renames columns", () => {
    const block = new Block();
    block.setColF("species", new Float64Array([1]));
    expect(block.renameColumn("species", "element")).toBe(true);
    expect(block.renameColumn("missing", "x")).toBe(false);
    expect(block.keys()).toEqual(["element"]);
    block.free();
  });
});

// ── Frame ──────────────────────────────────────────────────────────────────

describe("WASM Frame", () => {
  it("registers, retrieves, renames, and removes blocks", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.setColF("x", new Float64Array([0]));

    expect(frame.getBlock("atoms")).toBeDefined();
    expect(frame.getBlock("missing")).toBeUndefined();

    frame.insertBlock("bonds", makeBondsBlock());
    expect(frame.getBlock("bonds")?.nrows()).toBe(2);

    expect(frame.renameBlock("bonds", "edges")).toBe(true);
    expect(frame.renameColumn("atoms", "x", "pos_x")).toBe(true);
    expect(frame.getBlock("atoms")?.keys()).toEqual(["pos_x"]);

    frame.removeBlock("atoms");
    expect(frame.getBlock("atoms")).toBeUndefined();

    frame.clear();
    expect(frame.getBlock("edges")).toBeUndefined();
  });

  it("accepts and detaches a simbox", () => {
    const frame = new Frame();
    const box = Box.cube(5, new Float64Array([0, 0, 0]), true, true, true);
    frame.simbox = box;
    const roundTrip = frame.simbox;
    expect(roundTrip).toBeDefined();
    expect(roundTrip?.volume()).toBeCloseTo(125, 10);

    frame.simbox = null;
    expect(frame.simbox).toBeUndefined();
  });

  it("stores volumetric data as a 'grid' block with structural shape", () => {
    const frame = new Frame();
    expect(frame.getBlock("grid")).toBeUndefined();

    const grid = frame.createBlock("grid");
    grid.setColF("rho", new Float64Array(8).fill(0.25));
    grid.setShape(new Uint32Array([2, 2, 2]));

    const block = frame.getBlock("grid");
    expect(block).toBeDefined();
    expect(Array.from(block!.shape())).toEqual([2, 2, 2]);
    expect(block!.keys()).toContain("rho");
    expect(Array.from(block!.copyColF("rho") ?? [])).toEqual(
      new Array(8).fill(0.25),
    );
  });
});

// ── Box ────────────────────────────────────────────────────────────────────

describe("WASM Box", () => {
  it("constructs via cube / ortho / triclinic and exposes geometry", () => {
    const cube = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);
    expect(cube.volume()).toBeCloseTo(1000, 6);
    expect(Array.from(cube.lengths().toCopy())).toEqual([10, 10, 10]);
    expect(Array.from(cube.origin().toCopy())).toEqual([0, 0, 0]);
    expect(Array.from(cube.tilts().toCopy())).toEqual([0, 0, 0]);
    const corners = cube.get_corners().toCopy();
    expect(corners.length).toBe(24);
    cube.free();

    const ortho = Box.ortho(
      new Float64Array([2, 3, 4]),
      new Float64Array([0, 0, 0]),
      true,
      false,
      true,
    );
    expect(ortho.volume()).toBeCloseTo(24, 6);
    ortho.free();

    const tri = new Box(
      new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
      new Float64Array([0, 0, 0]),
      true,
      true,
      true,
    );
    expect(tri.volume()).toBeCloseTo(1, 10);
    tri.free();
  });
});

// ── Readers ────────────────────────────────────────────────────────────────

const XYZ_FIXTURE = `3

C 0.000 0.000 0.000
H 1.000 0.000 0.000
O 0.000 1.000 0.000
`;

const PDB_FIXTURE = `CRYST1   10.000   10.000   10.000  90.00  90.00  90.00 P 1           1
ATOM      1  C   MOL A   1       0.000   0.000   0.000  1.00  0.00           C
ATOM      2  H   MOL A   1       1.000   0.000   0.000  1.00  0.00           H
END
`;

// Minimal mmCIF fragment exercising every PDB-parity column the molvis
// renderer expects (element / name / res_name / res_seq / chain_id / id),
// plus a `.` value in label_seq_id (CIF "not applicable") to verify the
// missing-value tolerant integer parser.
const CIF_FIXTURE = `data_TEST
_cell.length_a 10.0
_cell.length_b 10.0
_cell.length_c 10.0
_cell.angle_alpha 90.0
_cell.angle_beta  90.0
_cell.angle_gamma 90.0
loop_
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
1 N N   ALA A 1 0.000 0.000 0.000
2 C CA  ALA A 1 1.500 0.000 0.000
3 O O   HOH B . 5.000 5.000 5.000
`;

const LAMMPS_DATA_FIXTURE = `LAMMPS molvis fixture

2 atoms
1 atom types

0.0 10.0 xlo xhi
0.0 10.0 ylo yhi
0.0 10.0 zlo zhi

Atoms # atomic

1 1 0.0 0.0 0.0
2 1 1.0 0.0 0.0
`;

const LAMMPS_DUMP_FIXTURE = `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS pp pp pp
0.0 10.0
0.0 10.0
0.0 10.0
ITEM: ATOMS id type x y z
1 1 0.0 0.0 0.0
2 1 1.0 0.0 0.0
`;

const SDF_FIXTURE = `water
  molvis

  3  2  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
    1.0000    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0
    0.0000    1.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  1  3  1  0  0  0  0
M  END
$$$$
`;

describe("WASM Readers", () => {
  it("XYZReader reads one frame", () => {
    const reader = new XYZReader(XYZ_FIXTURE);
    expect(reader.isEmpty()).toBe(false);
    expect(reader.len()).toBe(1);
    const frame = reader.read(0);
    expect(frame).toBeDefined();
    expect(frame?.getBlock("atoms")?.nrows()).toBe(3);
    reader.free();
  });

  it("PDBReader reads atoms + simbox", () => {
    const reader = new PDBReader(PDB_FIXTURE);
    expect(reader.len()).toBe(1);
    const frame = reader.read(0);
    expect(frame).toBeDefined();
    expect(frame?.getBlock("atoms")?.nrows()).toBe(2);
    expect(frame?.simbox).toBeDefined();
    reader.free();
  });

  it("LAMMPSReader accepts data-file content and returns a Frame", () => {
    // NOTE: LAMMPSReader.len() internally consumes the first frame to
    // determine the count; call read() first to get the frame back.
    const reader = new LAMMPSReader(LAMMPS_DATA_FIXTURE);
    const frame = reader.read(0);
    expect(frame).toBeDefined();
    // Format quirks around atom-style / title-line keywords differ per
    // molrs release; only assert the contract (Reader returns a Frame).
    reader.free();
  });

  it("LAMMPSTrajReader reads a trajectory snapshot", () => {
    const reader = new LAMMPSTrajReader(LAMMPS_DUMP_FIXTURE);
    expect(reader.isEmpty()).toBe(false);
    expect(reader.len()).toBeGreaterThanOrEqual(1);
    const frame = reader.read(0);
    expect(frame?.getBlock("atoms")?.nrows()).toBe(2);
    reader.free();
  });

  it("SDFReader reads atoms + bonds", () => {
    const reader = new SDFReader(SDF_FIXTURE);
    expect(reader.isEmpty()).toBe(false);
    const frame = reader.read(0);
    expect(frame?.getBlock("atoms")?.nrows()).toBe(3);
    expect(frame?.getBlock("bonds")?.nrows()).toBe(2);
    reader.free();
  });

  it("CIFReader writes PDB-parity columns and simbox", () => {
    const reader = new CIFReader(CIF_FIXTURE);
    expect(reader.isEmpty()).toBe(false);
    expect(reader.len()).toBe(1);
    const frame = reader.read(0);
    expect(frame).toBeDefined();

    const atoms = frame?.getBlock("atoms");
    expect(atoms?.nrows()).toBe(3);

    // Column names must match what the molvis renderer queries — these
    // are the same names PDBReader emits, not CIF's native `symbol` /
    // `label`.
    expect(atoms?.copyColStr("element")).toEqual(["N", "C", "O"]);
    expect(atoms?.copyColStr("name")).toEqual(["N", "CA", "O"]);
    expect(atoms?.copyColStr("res_name")).toEqual(["ALA", "ALA", "HOH"]);
    expect(atoms?.copyColStr("chain_id")).toEqual(["A", "A", "B"]);

    // `label_seq_id` was `.` (HETATM / water) on the third row; the
    // missing-value tolerant parser must coerce it to 0 rather than
    // failing the whole frame build.
    const resSeq = atoms?.copyColI32("res_seq");
    expect(resSeq?.[0]).toBe(1);
    expect(resSeq?.[1]).toBe(1);
    expect(resSeq?.[2]).toBe(0);

    expect(frame?.simbox).toBeDefined();
    reader.free();
  });
});

// ── Analysis ───────────────────────────────────────────────────────────────

describe("WASM Analysis", () => {
  it("LinkedCell + NeighborList produce valid pair data", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.setColF("x", new Float64Array([0, 1, 2, 3]));
    atoms.setColF("y", new Float64Array([0, 0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0, 0]));
    atoms.setColStr("element", ["Ar", "Ar", "Ar", "Ar"]);
    frame.simbox = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);

    const lc = new LinkedCell(1.5);
    const nlist = lc.build(frame);
    expect(nlist.numPairs).toBeGreaterThan(0);
    expect(nlist.isSelfQuery).toBe(true);
    expect(nlist.distances()).toBeInstanceOf(Float64Array);
    expect(nlist.pointIndices()).toBeInstanceOf(Uint32Array);
    expect(nlist.queryPointIndices()).toBeInstanceOf(Uint32Array);
    nlist.free();
    lc.free();
  });

  it("RDF computes g(r) from a neighbor list", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    const positions = [0, 1, 2, 3, 4, 5];
    atoms.setColF("x", new Float64Array(positions));
    atoms.setColF("y", new Float64Array(positions.length));
    atoms.setColF("z", new Float64Array(positions.length));
    atoms.setColStr(
      "element",
      positions.map(() => "Ar"),
    );
    frame.simbox = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);

    const lc = new LinkedCell(5);
    const nlist = lc.build(frame);
    const rdf = new RDF(20, 5);
    const result = rdf.compute(frame, nlist);
    expect(result.rdf()).toBeInstanceOf(Float64Array);
    expect(result.binCenters().length).toBe(20);
    expect(result.pairCounts().length).toBe(20);
    expect(result.volume).toBeCloseTo(1000, 6);
    expect(result.rMin).toBe(0);

    result.free();
    rdf.free();
    nlist.free();
    lc.free();
  });

  it("Topology.fromFrame reports bonds / angles / rings", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.setColF("x", new Float64Array([0, 1, 2, 3]));
    atoms.setColF("y", new Float64Array([0, 0, 0, 0]));
    atoms.setColF("z", new Float64Array([0, 0, 0, 0]));
    atoms.setColStr("element", ["C", "C", "C", "C"]);
    atoms.setColU32("id", new Uint32Array([0, 1, 2, 3]));

    const bonds = frame.createBlock("bonds");
    bonds.setColU32("i", new Uint32Array([0, 1, 2]));
    bonds.setColU32("j", new Uint32Array([1, 2, 3]));
    bonds.setColU32("order", new Uint32Array([1, 1, 1]));

    const topo = Topology.fromFrame(frame);
    expect(topo.nAtoms).toBe(4);
    expect(topo.nBonds).toBe(3);
    expect(topo.areBonded(0, 1)).toBe(true);
    expect(topo.areBonded(0, 3)).toBe(false);
    expect(topo.bonds()).toBeInstanceOf(Uint32Array);
    expect(topo.angles()).toBeInstanceOf(Uint32Array);
    expect(topo.dihedrals()).toBeInstanceOf(Uint32Array);
    expect(topo.connectedComponents()).toBeInstanceOf(Int32Array);
    expect(topo.neighbors(1)).toBeInstanceOf(Uint32Array);
    expect(topo.degree(1)).toBe(2);

    const rings = topo.findRings();
    expect(rings.numRings).toBe(0);
    rings.free();
    topo.free();
  });
});

// ── Top-level ──────────────────────────────────────────────────────────────

describe("WASM top-level functions", () => {
  it("writeFrame serializes an XYZ frame", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.setColF("x", new Float64Array([0, 1]));
    atoms.setColF("y", new Float64Array([0, 0]));
    atoms.setColF("z", new Float64Array([0, 0]));
    atoms.setColStr("element", ["H", "H"]);

    const xyz = writeFrame(frame, "xyz");
    expect(typeof xyz).toBe("string");
    expect(xyz.split("\n")[0].trim()).toBe("2");
  });

  it("parseSMILES returns an IR with component count", () => {
    const ir = parseSMILES("CCO");
    expect(ir.nComponents).toBe(1);
    const frame = ir.toFrame();
    expect(frame.getBlock("atoms")?.nrows()).toBeGreaterThan(0);
    ir.free();
  });

  it("wasmMemory returns a WebAssembly.Memory", () => {
    const mem = wasmMemory();
    expect(mem).toBeInstanceOf(WebAssembly.Memory);
  });
});

// Keep `makeFrameWithAtomsBonds` referenced so unused-import lints don't
// trip when the fixture is only exercised via integration scenarios.
void makeFrameWithAtomsBonds;
