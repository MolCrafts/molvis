import { toDomainUint } from "@molcrafts/molvis-core";
import { Block, Box, Cell, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { AnalysisDefinition } from "../../src/analysis/registry";
import {
  getAnalysisCatalog,
  getAnalysisDefinition,
} from "../../src/analysis/registry";
import { analysisAvailability } from "../../src/analysis/requirements";
import {
  CatalogAccumulator,
  runSingleFrame,
} from "../../src/analysis/shape_dispatch";
import { AnalysisUnsupportedError } from "../../src/analysis/trajectory_runner";

// ---------------------------------------------------------------------------
// `runSingleFrame` and `CatalogAccumulator` are the thread-independent half of
// analysis dispatch: frames in, one plain-data payload out, built from the
// catalog entry alone — never from its id. These cases drive them directly,
// no trajectory, no worker, no page.
// ---------------------------------------------------------------------------

const NO_SUBSET: readonly number[] = [];

function definition(id: string): AnalysisDefinition {
  const found = getAnalysisDefinition(id);
  if (!found) throw new Error(`${id} missing from the catalog`);
  return found;
}

/** Two atoms `separation` Å apart along x, in a 20 Å periodic cube. */
function pairFrame(separation: number): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", Float64Array.from([0, separation]));
  atoms.set("y", Float64Array.from([0, 0]));
  atoms.set("z", Float64Array.from([0, 0]));
  atoms.set("element", ["Ar", "Ar"]);
  frame.set("atoms", atoms);
  frame.box = new Box(
    Cell.lengths(new Float64Array([20, 20, 20])),
    new Float64Array(3),
    [true, true, true],
  );
  return frame;
}

/**
 * A 3×3×3 simple cubic lattice at 2 Å spacing in a 6 Å periodic cube — one
 * connected cluster under a 2.5 Å cutoff — with bonds along x so the
 * bond-derived inputs have something to read.
 */
function latticeFrame(): Frame {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let ix = 0; ix < 3; ix++) {
    for (let iy = 0; iy < 3; iy++) {
      for (let iz = 0; iz < 3; iz++) {
        xs.push(ix * 2 + 0.1 * iz);
        ys.push(iy * 2);
        zs.push(iz * 2);
      }
    }
  }
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", Float64Array.from(xs));
  atoms.set("y", Float64Array.from(ys));
  atoms.set("z", Float64Array.from(zs));
  atoms.set(
    "element",
    xs.map(() => "C"),
  );
  frame.set("atoms", atoms);
  // A chain 0-9-18 plus 1-10 and 10-19: angles and a dihedral exist.
  const bonds = new Block();
  bonds.set("atomi", toDomainUint([0, 9, 1, 10, 0]));
  bonds.set("atomj", toDomainUint([9, 18, 10, 19, 1]));
  frame.set("bonds", bonds);
  frame.box = new Box(
    Cell.lengths(new Float64Array([6, 6, 6])),
    new Float64Array(3),
    [true, true, true],
  );
  return frame;
}

/** Atoms on a line moving at constant velocity (vx), `frames` frames. */
function movingFrames(frames: number): Frame[] {
  return Array.from({ length: frames }, (_, t) => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.set("x", Float64Array.from([t, 5 + t * 0.5, 10]));
    atoms.set("y", Float64Array.from([0, 0, 0]));
    atoms.set("z", Float64Array.from([0, 0, 0]));
    atoms.set("vx", Float64Array.from([1, 0.5, Math.cos(t)]));
    atoms.set("vy", Float64Array.from([0, 0, Math.sin(t)]));
    atoms.set("vz", Float64Array.from([0, 0, 0]));
    frame.set("atoms", atoms);
    return frame;
  });
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`expected a payload object, got ${String(value)}`);
  }
  return value as Record<string, unknown>;
}

function f64(value: unknown): Float64Array {
  if (!(value instanceof Float64Array)) {
    throw new Error(`expected a Float64Array, got ${String(value)}`);
  }
  return value;
}

describe("runSingleFrame", () => {
  it("answers plain data, not a WASM handle", () => {
    const payload = record(
      runSingleFrame(
        pairFrame(1.5),
        definition("diffraction.static_structure_factor"),
        { k_values: "0.5,1.625,2.75" },
        NO_SUBSET,
      ),
    );
    expect(Array.from(f64(payload.k_values))).toEqual([0.5, 1.625, 2.75]);
    expect(payload.n_particles).toBe(2);
    expect(payload.shapes).toEqual({ k_values: [3], sk: [3] });
    expect(typeof payload.free).toBe("undefined");
    expect(typeof payload.toJSON).toBe("undefined");
  });

  it("marshals the RDF of one pair into its bin", () => {
    const payload = record(
      runSingleFrame(
        pairFrame(1.05),
        definition("density.radial_distribution"),
        { n_bins: 50, r_max: 5, r_min: 0 },
        NO_SUBSET,
      ),
    );
    // r_max 5 / 50 bins → dr = 0.1 Å; the single 1.05 Å pair lands in bin 10.
    const centers = f64(payload.bin_centers);
    const counts = f64(payload.n_r);
    expect(centers.length).toBe(50);
    expect(centers[0]).toBeCloseTo(0.05, 12);
    expect(counts[10]).toBeGreaterThan(0);
    expect(Array.from(counts).filter((count) => count !== 0)).toHaveLength(1);
    expect(payload.volume).toBeCloseTo(8000, 6);
  });

  it("coerces text params to the kinds their spec declares", () => {
    const payload = record(
      runSingleFrame(
        pairFrame(1.05),
        definition("density.radial_distribution"),
        { n_bins: "50.9", r_max: "5", r_min: "0" },
        NO_SUBSET,
      ),
    );
    // An `int` truncates rather than rounds.
    expect(f64(payload.bin_centers).length).toBe(50);
  });

  it("falls back to the row default for an omitted param", () => {
    const payload = record(
      runSingleFrame(
        pairFrame(1.05),
        definition("density.radial_distribution"),
        {},
        NO_SUBSET,
      ),
    );
    expect(f64(payload.bin_centers).length).toBe(100);
  });

  it("names the parameter whose value is not a number", () => {
    expect(() =>
      runSingleFrame(
        pairFrame(1.5),
        definition("density.radial_distribution"),
        { n_bins: "abc" },
        NO_SUBSET,
      ),
    ).toThrow(/n_bins/);
  });

  it("builds the clustering a center-of-mass partition needs", () => {
    const payload = record(
      runSingleFrame(
        latticeFrame(),
        definition("shape.center_of_mass"),
        { cutoff: 2.5, min_cluster_size: 1 },
        NO_SUBSET,
      ),
    );
    expect(payload.groups).toEqual([0]);
    expect(payload.shapes).toMatchObject({ centers: [1, 3] });
    expect(f64(payload.total_masses)[0]).toBeCloseTo(27, 12);
  });

  it("adds a gyration result's radius of gyration", () => {
    const payload = record(
      runSingleFrame(
        latticeFrame(),
        definition("shape.cluster_properties"),
        { cutoff: 2.5, min_cluster_size: 1 },
        NO_SUBSET,
      ),
    );
    expect(f64(payload.radius_of_gyration)).toHaveLength(1);
    expect(f64(payload.radius_of_gyration)[0]).toBeGreaterThan(0);
  });

  it("runs every frame analysis the lattice can feed", () => {
    const catalog = getAnalysisCatalog();
    const ran: string[] = [];
    for (const entry of catalog.analyses) {
      if (entry.inputKind !== "frame") continue;
      const frame = latticeFrame();
      const availability = analysisAvailability(frame, entry, {
        hasSelection: true,
      });
      if (!availability.runnable) continue;
      const params: Record<string, number | boolean | string> = {};
      // Small grids keep the voxel and diffraction analyses fast.
      if (entry.params.some((p) => p.key === "dims")) params.dims = "8,8,8";
      if (entry.params.some((p) => p.key === "n_grid")) params.n_grid = 16;
      const payload = record(runSingleFrame(frame, entry, params, [0, 1]));
      expect(payload.shapes).toBeDefined();
      ran.push(entry.id);
    }
    // Everything the lattice satisfies: all but the trajectory and
    // descriptor-matrix entries.
    expect(ran).toContain("locality.voronoi_void_analysis");
    expect(ran).toContain("distribution.bond_distribution");
    expect(ran).toContain("order.solid_liquid");
    expect(ran.length).toBeGreaterThanOrEqual(20);
  }, 60_000);

  it("refuses a trajectory analysis, naming it", () => {
    const vacf = definition("transport.vacf");
    let thrown: unknown;
    try {
      runSingleFrame(pairFrame(1.5), vacf, {}, NO_SUBSET);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AnalysisUnsupportedError);
    expect((thrown as AnalysisUnsupportedError).analysisId).toBe(vacf.id);
  });
});

describe("CatalogAccumulator", () => {
  it("stacks velocities across fed frames into a VACF", () => {
    const accumulator = new CatalogAccumulator(definition("transport.vacf"), {
      max_lag: 3,
      dt: 2,
    });
    for (const frame of movingFrames(6)) accumulator.feed(frame);
    const payload = record(accumulator.result());
    expect(Array.from(f64(payload.lag_times))).toEqual([0, 2, 4, 6]);
    expect(f64(payload.values)).toHaveLength(4);
  });

  it("feeds the VACF into a power spectrum", () => {
    const accumulator = new CatalogAccumulator(
      definition("spectroscopy.power_spectrum"),
      { max_lag: 3, dt: 1, window: "hann", pad: 2 },
    );
    for (const frame of movingFrames(6)) accumulator.feed(frame);
    const payload = record(accumulator.result());
    expect(f64(payload.frequencies).length).toBeGreaterThan(0);
    expect(f64(payload.real).length).toBe(f64(payload.frequencies).length);
  });

  it("supplies the MSD max lag from the frames fed", () => {
    const accumulator = new CatalogAccumulator(
      definition("msd.mean_squared_displacement"),
      { dt: 1 },
    );
    for (const frame of movingFrames(4)) accumulator.feed(frame);
    const payload = record(accumulator.result());
    // Atoms 0 and 1 move 1 and 0.5 Å per frame; atom 2 sits still.
    const values = f64(payload.values);
    expect(values).toHaveLength(4);
    expect(values[0]).toBeCloseTo(0, 12);
    expect(values[1]).toBeCloseTo((1 + 0.25) / 3, 12);
  });

  it("follows only the atoms it is fed", () => {
    const accumulator = new CatalogAccumulator(
      definition("msd.mean_squared_displacement"),
      { dt: 1 },
    );
    for (const frame of movingFrames(3)) accumulator.feed(frame, [0]);
    const values = f64(record(accumulator.result()).values);
    expect(values[1]).toBeCloseTo(1, 12);
    expect(values[2]).toBeCloseTo(4, 12);
  });

  it("refuses a frame whose atom count changed", () => {
    const accumulator = new CatalogAccumulator(
      definition("msd.mean_squared_displacement"),
      { dt: 1 },
    );
    const frames = movingFrames(2);
    accumulator.feed(frames[0]);
    expect(() => accumulator.feed(frames[1], [0])).toThrow(/atoms/);
  });
});
