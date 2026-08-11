import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { AnalysisFrameSnapshot } from "../../src/analysis/worker_protocol";
import {
  analysisJobTransferList,
  snapshotFrameForAnalysis,
} from "../../src/analysis/worker_protocol";

// ---------------------------------------------------------------------------
// Fixture (hard-coded): four atoms with an `id` column and an orthorhombic
// cell whose three edges and origin all differ, so a squared / dropped /
// re-ordered cell cannot pass by coincidence.
// ---------------------------------------------------------------------------

const X = [1.25, 2.5, 3.75, -0.5] as const;
const Y = [0.5, -1.5, 2.25, 4.0] as const;
const Z = [-3.25, 0.0, 1.5, 2.75] as const;
const ELEMENTS = ["O", "H", "H", "C"] as const;
/** Canonical `id` column (molrs binds `id` to `UInt`). */
const IDS = [10, 11, 12, 13] as const;
const BOX_LENGTHS = [10, 12, 14] as const;
const BOX_ORIGIN = [1, 0, 0] as const;
/**
 * LAMMPS tilts `[xy, xz, yz]` (Å) of {@link triclinicCell} — one non-zero
 * entry, so a dropped / re-ordered tilt triple cannot pass by coincidence.
 */
const BOX_TILTS = [2.5, 0, 0] as const;

/** Four-atom frame with x/y/z + element + id, and an optional cell. */
function makeFrame(box?: Box): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", Float64Array.from(X));
  atoms.setColF("y", Float64Array.from(Y));
  atoms.setColF("z", Float64Array.from(Z));
  atoms.setColStr("element", [...ELEMENTS]);
  atoms.setColU32("id", Uint32Array.from(IDS));
  frame.insertBlock("atoms", atoms);
  // `Frame.box` MOVES the handle it is given — the caller must not touch the
  // Box afterwards, and every attach constructs its own.
  if (box) frame.box = box;
  return frame;
}

function orthoCell(): Box {
  return Box.ortho(
    Float64Array.from(BOX_LENGTHS),
    Float64Array.from(BOX_ORIGIN),
    true,
    true,
    true,
  );
}

/**
 * Triclinic cell (LAMMPS-style xy tilt) as a row-major h matrix.
 *
 * Exactly `hMatrixFromLammps(BOX_LENGTHS, BOX_TILTS)` (`pipeline/draw_box.ts`):
 * lattice vectors are the columns of h, so `lx / ly / lz` stay on the diagonal
 * and the tilts sit above it.
 */
function triclinicCell(): Box {
  // a = (10,0,0), b = (2.5,12,0), c = (0,0,14) — xy tilt 2.5 Å.
  const h = Float64Array.from([10, 2.5, 0, 0, 12, 0, 0, 0, 14]);
  return new Box(h, Float64Array.from(BOX_ORIGIN), true, true, true);
}

describe("snapshotFrameForAnalysis", () => {
  it("captures coordinates, elements, ids, and the cell", () => {
    const snapshot = snapshotFrameForAnalysis(makeFrame(orthoCell()), 7);

    // Frame index is the caller's own numbering (strided ranges stay addressable).
    expect(snapshot.frameIndex).toBe(7);

    expect(snapshot.x).toBeInstanceOf(Float64Array);
    expect(snapshot.y).toBeInstanceOf(Float64Array);
    expect(snapshot.z).toBeInstanceOf(Float64Array);
    expect(snapshot.x.length).toBe(4);
    expect(snapshot.y.length).toBe(4);
    expect(snapshot.z.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      // Position tolerance (Å): exact copy of the column.
      expect(snapshot.x[i]).toBeCloseTo(X[i], 12);
      expect(snapshot.y[i]).toBeCloseTo(Y[i], 12);
      expect(snapshot.z[i]).toBeCloseTo(Z[i], 12);
    }

    expect(snapshot.elements).toEqual([...ELEMENTS]);

    // `id` is a u32 column, so the snapshot dtype is Uint32Array — a Float64
    // or plain-array copy would lose the "same atoms across frames" guarantee
    // MSD depends on.
    expect(snapshot.ids).toBeInstanceOf(Uint32Array);
    expect(Array.from(snapshot.ids ?? new Uint32Array(0))).toEqual([...IDS]);

    expect(snapshot.boxLengths).toBeInstanceOf(Float64Array);
    expect(snapshot.boxOrigin).toBeInstanceOf(Float64Array);
    for (let i = 0; i < 3; i++) {
      expect(snapshot.boxLengths?.[i]).toBeCloseTo(BOX_LENGTHS[i], 12);
      expect(snapshot.boxOrigin?.[i]).toBeCloseTo(BOX_ORIGIN[i], 12);
    }

    // An orthorhombic cell has no tilts, and the snapshot says so by omission
    // rather than by shipping a zero triple the worker has to interpret.
    expect(snapshot.boxTilts).toBeUndefined();
  });

  it("snapshots a free-boundary frame without a cell", () => {
    // No cell → the worker must run free-boundary (no periodic images) rather
    // than invent one.
    const snapshot = snapshotFrameForAnalysis(makeFrame(), 0);

    expect(snapshot.boxLengths).toBeUndefined();
    expect(snapshot.boxOrigin).toBeUndefined();
    expect(snapshot.x.length).toBe(4);
  });

  it("captures a triclinic cell as lengths, origin, and tilts", () => {
    // The molrs RDF kernel is triclinic-native, so the wire CARRIES the tilted
    // cell as plain data. Refusing it (or squaring it) is what regressed
    // triclinic trajectories against the old main-thread path.
    const snapshot = snapshotFrameForAnalysis(makeFrame(triclinicCell()), 3);

    expect(snapshot.boxLengths).toBeInstanceOf(Float64Array);
    expect(snapshot.boxOrigin).toBeInstanceOf(Float64Array);
    expect(snapshot.boxTilts).toBeInstanceOf(Float64Array);

    // Hard-coded goldens for the h matrix in `triclinicCell` — the LAMMPS
    // `lx ly lz` diagonal plus the `xy xz yz` tilts, i.e. the exact pair
    // `hMatrixFromLammps` round-trips back to that same cell.
    //
    // NOTE: molrs `Box.lengths()` reports the cell-vector *norms*
    // (|b| = 12.257650672131263 Å here), which is NOT `ly`. Forwarding
    // `lengths()` unchanged for a tilted cell mixes two conventions and is the
    // bug this golden catches.
    for (let i = 0; i < 3; i++) {
      expect(snapshot.boxLengths?.[i]).toBeCloseTo(BOX_LENGTHS[i], 12);
      expect(snapshot.boxOrigin?.[i]).toBeCloseTo(BOX_ORIGIN[i], 12);
      expect(snapshot.boxTilts?.[i]).toBeCloseTo(BOX_TILTS[i], 12);
    }
  });
});

describe("analysisJobTransferList", () => {
  it("covers every buffer exactly once", () => {
    // Hand-built snapshots (not `snapshotFrameForAnalysis`) so this case fails
    // on the transfer list alone. Every array gets its own buffer, so a shared
    // ArrayBuffer cannot hide a duplicate entry.
    const frame = (
      frameIndex: number,
      tilts?: Float64Array,
    ): AnalysisFrameSnapshot => ({
      frameIndex,
      x: Float64Array.from([0, 1]),
      y: Float64Array.from([0, 0]),
      z: Float64Array.from([0, 0]),
      elements: ["Ar", "Ar"],
      ids: Uint32Array.from([1, 2]),
      boxLengths: Float64Array.from([20, 20, 20]),
      boxOrigin: Float64Array.from([0, 0, 0]),
      boxTilts: tilts,
    });

    const list = analysisJobTransferList({
      analysisId: "rdf.radial_distribution",
      params: { rMax: 5, nBins: 50 },
      // Mixed on purpose: an orthorhombic frame and a tilted one, so the tilt
      // buffer has to be added per frame rather than assumed present or absent.
      frames: [frame(0), frame(1, Float64Array.from([2.5, 0, 0]))],
    });

    // Hard-coded golden: 6 buffers for the orthorhombic frame (x, y, z, ids,
    // boxLengths, boxOrigin) + 7 for the triclinic one (those plus boxTilts).
    expect(list.length).toBe(13);
    expect(new Set(list).size).toBe(list.length);
  });
});
