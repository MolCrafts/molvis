import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { AnalysisDefinition } from "../../src/analysis/registry";
import { getAnalysisDefinition } from "../../src/analysis/registry";
import type { AnalysisParamValues } from "../../src/analysis/shape_dispatch";
import { runSingleFrame } from "../../src/analysis/shape_dispatch";
import { AnalysisUnsupportedError } from "../../src/analysis/trajectory_runner";

// ---------------------------------------------------------------------------
// `runSingleFrame` is the thread-independent half of analysis dispatch: one
// molrs frame in, one plain-data payload out, chosen by the definition's
// `inputKind` and never by its id. These cases drive it directly — no
// trajectory, no worker, no page — which is the whole claim the kernel module
// makes about itself.
//
// Catalog ids are the molrs compute-catalog keys (`AnalysisDefinition.id`), the
// same strings `dispatch.ts` and the panels route on; a short local spelling
// would be a second id vocabulary.
// ---------------------------------------------------------------------------

const RDF_ID = "rdf.radial_distribution";
const COM_ID = "shape.center_of_mass";

/** No atom subset: only the `frameRadii` shape reads it. */
const ALL_ATOMS: readonly number[] = [];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Cubic periodic cell (Å) big enough that only the primary image is in range. */
const PAIR_BOX_LENGTHS = [20, 20, 20] as const;
const ORIGIN = [0, 0, 0] as const;

/** Two atoms `separation` Å apart along x, in the periodic cell above. */
function pairFrame(separation: number): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", Float64Array.from([0, separation]));
  atoms.setColF("y", Float64Array.from([0, 0]));
  atoms.setColF("z", Float64Array.from([0, 0]));
  atoms.setColStr("element", ["Ar", "Ar"]);
  frame.insertBlock("atoms", atoms);
  // `Frame.box` MOVES the handle — build a fresh Box per attach.
  frame.box = Box.ortho(
    Float64Array.from(PAIR_BOX_LENGTHS),
    Float64Array.from(ORIGIN),
    true,
    true,
    true,
  );
  return frame;
}

/** Lattice edge, spacing (Å) and cell edge (Å) of {@link latticeFrame}. */
const LATTICE_N = 3;
const LATTICE_SPACING = 2;
const LATTICE_BOX = 6;

/**
 * A 3×3×3 simple cubic lattice at 2 Å spacing filling a 6 Å periodic cell, so
 * every atom is within 2 Å of a neighbor and the whole frame is exactly one
 * connected cluster — the clustering the `frameClusters` shape builds first.
 */
function latticeFrame(): Frame {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let ix = 0; ix < LATTICE_N; ix++) {
    for (let iy = 0; iy < LATTICE_N; iy++) {
      for (let iz = 0; iz < LATTICE_N; iz++) {
        xs.push(ix * LATTICE_SPACING);
        ys.push(iy * LATTICE_SPACING);
        zs.push(iz * LATTICE_SPACING);
      }
    }
  }
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", Float64Array.from(xs));
  atoms.setColF("y", Float64Array.from(ys));
  atoms.setColF("z", Float64Array.from(zs));
  atoms.setColStr(
    "element",
    xs.map(() => "Ar"),
  );
  frame.insertBlock("atoms", atoms);
  frame.box = Box.cube(
    LATTICE_BOX,
    Float64Array.from(ORIGIN),
    true,
    true,
    true,
  );
  return frame;
}

/**
 * A minimal hand-written `frame`-shaped definition: three constructor-slot
 * params and a `wasmExport` that really is exported by molrs
 * (`diffraction.static_structure_factor` names the same class in the catalog).
 *
 * Hand-written on purpose — the `frame` shape is `new Ctor(...ctorParams)` then
 * `compute(frame)`, and a fixture spelled out here shows exactly which fields
 * drive that, where a catalog lookup would hide it.
 */
const STRUCTURE_FACTOR: AnalysisDefinition = {
  id: "test.static_structure_factor",
  category: "diffraction",
  label: "Static structure factor (test fixture)",
  wasmExport: "WasmStaticStructureFactorDebye",
  inputKind: "frame",
  resultKind: "lineSeries",
  requires: [],
  params: [
    {
      key: "kMin",
      label: "k min",
      kind: "float",
      default: 0.5,
      optional: false,
      slot: "ctor",
      unit: "Å⁻¹",
    },
    {
      key: "kMax",
      label: "k max",
      kind: "float",
      default: 5,
      optional: false,
      slot: "ctor",
      unit: "Å⁻¹",
    },
    {
      key: "nK",
      label: "k samples",
      kind: "int",
      default: 4,
      optional: false,
      slot: "ctor",
    },
  ],
};

/**
 * A hand-written `frameGroupSets` definition — the joint-distribution shape no
 * per-frame dispatcher implements (`distribution.combined_distribution` is the
 * catalog entry that has it).
 */
const GROUP_SETS: AnalysisDefinition = {
  id: "test.combined_distribution",
  category: "distribution",
  label: "Combined distribution (test fixture)",
  wasmExport: "WasmCombinedDistribution",
  inputKind: "frameGroupSets",
  resultKind: "matrix",
  requires: ["atomGroups"],
  params: [],
};

/** The catalog definition for `id`, or a fixture failure naming it. */
function catalogDefinition(id: string): AnalysisDefinition {
  const definition = getAnalysisDefinition(id);
  if (!definition) throw new Error(`fixture: no catalog entry for ${id}`);
  return definition;
}

// ---------------------------------------------------------------------------
// Payload readers. `runSingleFrame` answers `unknown` by design (the shape
// belongs to the analysis), so each case narrows it through a checked reader
// instead of an `any` cast.
// ---------------------------------------------------------------------------

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Float64Array) return `Float64Array(${value.length})`;
  if (Array.isArray(value)) return `Array(${value.length})`;
  return typeof value;
}

function asRecord(label: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label} is not an object (got ${describeValue(value)})`);
  }
  return value as Record<string, unknown>;
}

function asNumber(label: string, value: unknown): number {
  if (typeof value !== "number") {
    throw new Error(`${label} is not a number (got ${describeValue(value)})`);
  }
  return value;
}

function asF64(label: string, value: unknown): Float64Array {
  if (!(value instanceof Float64Array)) {
    throw new Error(
      `${label} is not a Float64Array (got ${describeValue(value)})`,
    );
  }
  return value;
}

function asNumberArray(label: string, value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is not an array (got ${describeValue(value)})`);
  }
  return (value as unknown[]).map((entry, i) =>
    asNumber(`${label}[${i}]`, entry),
  );
}

/** The `k` grid and particle count of a `WasmStaticStructureFactorDebye` run. */
function asStructureFactor(value: unknown): {
  kValues: number[];
  nParticles: number;
  keys: string[];
  free: unknown;
} {
  const record = asRecord("structure factor payload", value);
  return {
    kValues: asNumberArray("structure factor payload.kValues", record.kValues),
    nParticles: asNumber(
      "structure factor payload.nParticles",
      record.nParticles,
    ),
    keys: Object.keys(record).sort(),
    // Read, not called: a WASM handle would answer a function here.
    free: (record as { free?: unknown }).free,
  };
}

/** Run one frame and read the payload as a plain record. */
function runRecord(
  frame: Frame,
  definition: AnalysisDefinition,
  params: AnalysisParamValues,
): Record<string, unknown> {
  return asRecord(
    `${definition.id} payload`,
    runSingleFrame(frame, definition, params, ALL_ATOMS),
  );
}

describe("runSingleFrame", () => {
  it("runs the `frame` shape and answers plain data, not a WASM handle", () => {
    const payload = runSingleFrame(
      pairFrame(1.5),
      STRUCTURE_FACTOR,
      { kMin: 0.5, kMax: 5, nK: 5 },
      ALL_ATOMS,
    );
    const result = asStructureFactor(payload);

    // Hard-coded golden (molrs 0.13.1 `WasmStaticStructureFactorDebye`): the
    // constructor samples `nK` points evenly over [kMin, kMax], so the grid is
    // fully determined by the three ctor-slot params above.
    expect(result.kValues.length).toBe(5);
    const expected = [0.5, 1.625, 2.75, 3.875, 5];
    for (let i = 0; i < expected.length; i++) {
      expect(result.kValues[i]).toBeCloseTo(expected[i], 12);
    }
    // The binding really read this frame: both atoms of the pair.
    expect(result.nParticles).toBe(2);

    // Plain data: three own fields and no `free`. A molrs result handle would
    // carry a `free` method here, and keeping one alive past the dispatch call
    // is exactly the leak the shape is supposed to make impossible.
    expect(result.keys).toEqual(["kValues", "nParticles", "sk"]);
    expect(typeof result.free).toBe("undefined");
  }, 30_000);

  it("coerces params to the kinds their spec declares", () => {
    // Panel state and the analysis wire both carry `number | boolean | string`,
    // so an `int` param that arrives as text has to reach the binding as a
    // number — `WasmStaticStructureFactorDebye` takes `usize` and would reject
    // the string outright.
    const fromText = asStructureFactor(
      runSingleFrame(
        pairFrame(1.5),
        STRUCTURE_FACTOR,
        { kMin: "0.5", kMax: "5", nK: "5" },
        ALL_ATOMS,
      ),
    );
    const expected = [0.5, 1.625, 2.75, 3.875, 5];
    expect(fromText.kValues.length).toBe(5);
    for (let i = 0; i < expected.length; i++) {
      expect(fromText.kValues[i]).toBeCloseTo(expected[i], 12);
    }

    // An `int` spec truncates rather than rounds, so 5.9 is 5 samples.
    const truncated = asStructureFactor(
      runSingleFrame(
        pairFrame(1.5),
        STRUCTURE_FACTOR,
        { kMin: 0.5, kMax: 5, nK: 5.9 },
        ALL_ATOMS,
      ),
    );
    expect(truncated.kValues.length).toBe(5);
  }, 30_000);

  it("falls back to the spec default for an omitted param", () => {
    // Nothing supplied: every ctor slot comes from `AnalysisParamSpec.default`,
    // i.e. kMin 0.5, kMax 5, nK 4 as declared on the fixture above.
    const result = asStructureFactor(
      runSingleFrame(pairFrame(1.5), STRUCTURE_FACTOR, {}, ALL_ATOMS),
    );
    const expected = [0.5, 2, 3.5, 5];
    expect(result.kValues.length).toBe(4);
    for (let i = 0; i < expected.length; i++) {
      expect(result.kValues[i]).toBeCloseTo(expected[i], 12);
    }
  }, 30_000);

  it("names the parameter whose value is not a number", () => {
    // The key, not just the value: "\"abc\" is not an integer" several frames
    // deep says nothing about which knob the panel has to fix.
    expect(() =>
      runSingleFrame(
        pairFrame(1.5),
        STRUCTURE_FACTOR,
        { kMin: 0.5, kMax: 5, nK: "abc" },
        ALL_ATOMS,
      ),
    ).toThrow(/nK/);
  }, 30_000);

  it("runs the `frameNeighbors` shape and marshals the RDF result table", () => {
    const definition = catalogDefinition(RDF_ID);
    const payload = runRecord(pairFrame(1.05), definition, {
      cutoff: 5,
      nBins: 50,
      rMax: 5,
      rMin: 0,
    });

    // `molrs.RDFResult` is an owned handle whose columns are behind *methods*.
    // Fields here mean the exit went through `marshalAnalysisResult`'s table
    // (`result_marshal.ts`), which copies the columns out and frees the handle.
    const binCenters = asF64("rdf payload.binCenters", payload.binCenters);
    const pairCounts = asF64("rdf payload.pairCounts", payload.pairCounts);
    expect(asNumber("rdf payload.numPoints", payload.numPoints)).toBe(2);
    expect(asNumber("rdf payload.volume", payload.volume)).toBeCloseTo(8000, 6);
    expect(asNumber("rdf payload.rMin", payload.rMin)).toBe(0);

    // Hard-coded goldens (molrs RDF over this fixture): rMax 5 / nBins 50 →
    // dr = 0.1 Å, so bin b spans [0.1·b, 0.1·(b+1)) and the single 1.05 Å pair
    // lands in bin 10 and nowhere else. A payload whose columns did not come
    // from this frame cannot reproduce that.
    expect(binCenters.length).toBe(50);
    expect(binCenters[0]).toBeCloseTo(0.05, 12);
    expect(pairCounts[10]).toBeCloseTo(1, 10);
    expect(Array.from(pairCounts).filter((count) => count !== 0)).toEqual([1]);
  }, 30_000);

  it("runs the `frameClusters` shape and marshals the center-of-mass table", () => {
    const definition = catalogDefinition(COM_ID);
    const payload = runRecord(latticeFrame(), definition, {
      cutoff: 2.5,
      minClusterSize: 1,
    });

    // The shape builds the neighbor list and the clustering itself before the
    // binding sees anything; at 2 Å spacing under a 2.5 Å cutoff the lattice is
    // one cluster, so the table is one row wide.
    const numClusters = asNumber(
      "com payload.numClusters",
      payload.numClusters,
    );
    expect(numClusters).toBe(1);

    // Same marshalling proof as the RDF case: `molrs.CenterOfMassResult` keeps
    // its columns behind methods, so these three fields exist only because the
    // `result_marshal` table copied them out.
    const centersOfMass = asF64(
      "com payload.centersOfMass",
      payload.centersOfMass,
    );
    const clusterMasses = asF64(
      "com payload.clusterMasses",
      payload.clusterMasses,
    );
    // Flat `[x, y, z, …]`: three components per cluster.
    expect(centersOfMass.length).toBe(3 * numClusters);
    expect(clusterMasses.length).toBe(numClusters);
    for (const component of centersOfMass) {
      expect(Number.isFinite(component)).toBe(true);
    }
  }, 30_000);

  it("refuses an input kind that is not a per-frame shape", () => {
    // `frameGroupSets` needs a per-observable atom-group editor, so there is
    // nothing for a single-frame dispatcher to do. It has to say so by analysis
    // id — a bare "unsupported" leaves the caller guessing which entry it was.
    let thrown: unknown;
    try {
      runSingleFrame(pairFrame(1.5), GROUP_SETS, {}, ALL_ATOMS);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AnalysisUnsupportedError);
    const error = thrown as AnalysisUnsupportedError;
    expect(error.analysisId).toBe(GROUP_SETS.id);
    expect(error.message).toContain(GROUP_SETS.id);
    expect(error.message).toContain("frameGroupSets");
  }, 30_000);
});
