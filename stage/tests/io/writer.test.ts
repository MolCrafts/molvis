/**
 * Writer round-trip tests: every molrs writer exposed through molvis.
 *
 * Loads a small inline fixture, writes it back via `writeFrame`, re-reads the
 * payload, and checks coordinates survive — exercising the WASM writers
 * (text `writeFrame` + binary `writeFrameBytes`) and the bidirectional
 * nm<->angstrom scaling for the GROMACS formats. Parser/writer correctness on
 * the full fixture set is covered Rust-side; this guards the TS boundary.
 */

import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { AtomSource, BondSource } from "../../src/entity_source";
import { loadBinaryTrajectory, loadTextTrajectory } from "../../src/io/reader";
import { exportFrame, writableFormats, writeFrame } from "../../src/io/writer";
import type { SceneIndex } from "../../src/scene_index";
import "../setup_wasm";

const WATER_GRO = `Water box
    3
    1WAT     OW    1   0.000   0.000   0.000
    1WAT    HW1    2   0.100   0.000   0.000
    1WAT    HW2    3   0.000   0.100   0.000
   2.00000   2.00000   2.00000
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

// Text GRO/MOL2/POSCAR goldens live in regressions/ (hard-coded public API).
// This file keeps binary writers + multi-format emit coverage only.

describe("text writer multi-format emit", () => {
  it("can emit XYZ, PDB and CIF for the same frame", () => {
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

// ── note topic `optimize-staging-followups` ────────────────────────────────
// "导出路径仍丢列": `exportFrame` (writer.ts:54) calls
// `buildFrameFromScene(sceneIndex, { markSaved: false })` with no source
// frame, so it can only emit the x/y/z/element whitelist — a `charge` the
// loaded file carried never reaches the writer. `buildFrameFromScene` already
// accepts `sourceFrame` and copies the columns across
// (scene_sync.ts:150, pinned by tests/build_frame_from_scene.test.ts); the fix
// is to thread it through `WriteFrameOptions` as an OPTIONAL field, so every
// existing caller keeps compiling.
//
// ASSERTION BOUNDARY (deliberate): text level, on mol2 — NOT on LAMMPS data.
// LAMMPS data also carries charge, but its writer hard-fails a frame with no
// `type` column ("has 3 rows but neither 'type' nor 'type_id'"), so the test
// would go red on a throw rather than on the missing charge — a wrong-reason
// RED. mol2 writes the same scene either way and reports the difference in
// two independent places: the `USER_CHARGES` / `NO_CHARGES` molecule-record
// flag, and a trailing charge field on each `@<TRIPOS>ATOM` line.
//
// Asserting at the materialize boundary instead would only re-test
// `buildFrameFromScene`, which is already covered; the whole point of this
// debt is that the bytes the user downloads lose the column.
//
// Charges are exactly representable in binary (0.5 / -0.25 / 0.125) so the
// text comparison is exact: nothing computes on this path, and a tolerance
// would only hide a narrowing bug.

function mockSceneIndex(atoms: AtomSource, bonds: BondSource): SceneIndex {
  return {
    metaRegistry: { atoms, bonds },
    markAllSaved() {},
  } as unknown as SceneIndex;
}

/** Water carrying `charge` — i.e. what a LAMMPS data load puts on the scene. */
function chargedSourceFrame(): Frame {
  const frame = new Frame();
  const block = new Block();
  block.setColF("x", new Float64Array([0, 1, 0]));
  block.setColF("y", new Float64Array([0, 0, 1]));
  block.setColF("z", new Float64Array([0, 0, 0]));
  block.setColStr("element", ["O", "H", "H"]);
  block.setColF("charge", new Float64Array([0.5, -0.25, 0.125]));
  frame.insertBlock("atoms", block);
  return frame;
}

/** `@<TRIPOS>ATOM` records, split into fields. */
function mol2AtomRecords(text: string): string[][] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === "@<TRIPOS>ATOM");
  if (start < 0) return [];
  const records: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trimStart().startsWith("@<TRIPOS>")) break;
    const trimmed = line.trim();
    if (trimmed.length > 0) records.push(trimmed.split(/\s+/));
  }
  return records;
}

/** Export the charged scene as mol2 through the path under test. */
function exportChargedSceneAsMol2(sourceFrame: Frame): string {
  const atoms = new AtomSource();
  atoms.setFrame(sourceFrame);
  const payload = exportFrame(mockSceneIndex(atoms, new BondSource()), {
    format: "mol2",
    filename: "out.mol2",
    sourceFrame,
  });
  return payload.content as string;
}

describe("exportFrame carries source-frame atom columns", () => {
  it("writes the scene's charge into the mol2 atom records", () => {
    const text = exportChargedSceneAsMol2(chargedSourceFrame());

    // molrs flags the molecule record `USER_CHARGES` when the frame has a
    // charge column and `NO_CHARGES` when it does not — the header alone
    // says whether the column reached the writer.
    expect(text).toContain("USER_CHARGES");
    expect(text).not.toContain("NO_CHARGES");

    // …and the per-atom charge is the trailing field of each ATOM record.
    const records = mol2AtomRecords(text);
    expect(records.length).toBe(3);
    expect(records.map((r) => Number(r[r.length - 1]))).toEqual([
      0.5, -0.25, 0.125,
    ]);
  });

  it("does not mutate the source frame it reads columns out of", () => {
    // Immutability is a documented contract of the build path
    // (build_frame_from_scene.test.ts "does NOT mutate/clear the source
    // frame"); threading `sourceFrame` through the writer must not break it.
    const sourceFrame = chargedSourceFrame();
    exportChargedSceneAsMol2(sourceFrame);

    const after = sourceFrame.getBlock("atoms");
    expect(after?.nrows()).toBe(3);
    expect(Array.from(after?.copyColF("charge") ?? [])).toEqual([
      0.5, -0.25, 0.125,
    ]);
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
