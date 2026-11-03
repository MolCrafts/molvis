import * as molrs from "@molcrafts/molvis-core/molrs";
import {
  Block,
  Box,
  Cell,
  ComputeSpec,
  Frame,
} from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  type AnalysisRequirement,
  buildAnalysisCatalog,
  defaultAnalysisParams,
  getAnalysisCatalog,
  isFrameColumnRequirement,
  type RawSpec,
  requirementColumns,
} from "../../src/analysis/registry";
import {
  analysisAvailability,
  frameHasStructure,
  probeRequirements,
} from "../../src/analysis/requirements";
import { ANALYSIS_ROWS, type AnalysisRow } from "../../src/analysis/ui_rows";

/**
 * The catalog joins molrs's `ComputeSpec.all()` with molvis's rows. These tests
 * pin the join: every row names a real compute and real parameters, every
 * spec without a row is reported, and each validation rule bites.
 */

const catalog = getAnalysisCatalog();
const specNames = (ComputeSpec.all() as Array<{ name: string }>).map(
  (spec) => spec.name,
);

/** A minimal periodic frame: positions only, no velocities, no bonds. */
function positionsOnlyFrame(withBox = true): Frame {
  const block = new Block();
  block.set("x", new Float64Array([0, 1, 2]));
  block.set("y", new Float64Array([0, 0, 0]));
  block.set("z", new Float64Array([0, 0, 0]));
  block.set("element", ["C", "C", "O"]);
  const frame = new Frame();
  frame.set("atoms", block);
  if (withBox) {
    frame.box = new Box(
      Cell.lengths(new Float64Array([10, 10, 10])),
      new Float64Array(3),
      [true, true, true],
    );
  }
  return frame;
}

function analysis(id: string) {
  const found = catalog.analyses.find((entry) => entry.id === id);
  if (!found) throw new Error(`${id} missing from catalog`);
  return found;
}

/** A hand-written spec in the shape `ComputeSpec.all()` serialises. */
const fakeSpec: RawSpec = {
  name: "Fake",
  params: [
    { name: "n_bins", kind: "Int", default: "Required" },
    { name: "stride", kind: "Int", default: { Value: { Int: 1 } } },
  ],
  inputs: [{ name: "positions", kind: "Positions", optional: false }],
  form: "Single",
};

const fakeRow: AnalysisRow = {
  id: "density.fake",
  spec: "Fake",
  category: "density",
  label: "Fake",
  resultKind: "table",
  params: { n_bins: { label: "Bins", default: 10 } },
};

describe("analysis catalog", () => {
  it("names only computes molrs has, each a class molrs exports", () => {
    for (const entry of catalog.analyses) {
      expect(specNames).toContain(entry.specName);
      expect(
        typeof (molrs as unknown as Record<string, unknown>)[entry.specName],
      ).toBe("function");
    }
  });

  it("presents one row per compute, under unique ids", () => {
    expect(catalog.analyses).toHaveLength(ANALYSIS_ROWS.length);
    const ids = catalog.analyses.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports every compute without a row, and no other", () => {
    const presented = new Set(catalog.analyses.map((entry) => entry.specName));
    expect(catalog.unpresented).toEqual(
      specNames.filter((name) => !presented.has(name)),
    );
    expect(catalog.unpresented).toContain("Correlator");
  });

  it("uses only declared categories", () => {
    const declared = new Set(catalog.categories.map((c) => c.id));
    for (const entry of catalog.analyses) {
      expect(declared.has(entry.category)).toBe(true);
    }
  });

  it("takes a parameter's kind and core default from the spec", () => {
    const steinhardt = analysis("order.steinhardt");
    const average = steinhardt.params.find((p) => p.key === "average");
    expect(average).toMatchObject({
      kind: "bool",
      default: false,
      optional: true,
      slot: "ctor",
    });
    const l = steinhardt.params.find((p) => p.key === "l");
    expect(l).toMatchObject({ kind: "intList", default: "6", optional: false });
    expect(defaultAnalysisParams(steinhardt)).toMatchObject({ cutoff: 3 });
  });

  it("lists a choice parameter's options from the spec", () => {
    const window = analysis("spectroscopy.power_spectrum").params.find(
      (p) => p.key === "window",
    );
    expect(window?.kind).toBe("select");
    expect(window?.options).toContain("hann");
  });

  it("derives the drive kind and requirements from the spec inputs", () => {
    expect(analysis("density.radial_distribution")).toMatchObject({
      inputKind: "frame",
      form: "Frames",
      requires: [],
    });
    expect(analysis("transport.vacf")).toMatchObject({
      inputKind: "trajectory",
      requires: ["velocity"],
    });
    expect(analysis("density.gaussian_density").requires).toEqual(["box"]);
    expect(analysis("distribution.bond_distribution").requires).toEqual([
      "atomPairs",
    ]);
    expect(analysis("ml.pca").requires).toEqual(["descriptorMatrix"]);
  });

  it("orders constructor arguments as the spec does, for the chosen form", () => {
    expect(analysis("diffraction.diffraction_pattern").ctorArgs).toEqual([
      "n_grid",
      "sigma",
      "axis",
      "cutoff",
    ]);
    expect(analysis("distribution.bond_distribution").ctorArgs).toEqual([
      "observable",
      "axis",
    ]);
  });
});

describe("catalog validation", () => {
  it("accepts a well-formed row and reports specs without one", () => {
    const built = buildAnalysisCatalog(
      [fakeSpec, { ...fakeSpec, name: "Other" }],
      [fakeRow],
    );
    expect(built.analyses.map((a) => a.id)).toEqual(["density.fake"]);
    expect(built.unpresented).toEqual(["Other"]);
  });

  it("refuses a row naming a compute molrs does not have", () => {
    expect(() =>
      buildAnalysisCatalog([fakeSpec], [{ ...fakeRow, spec: "Missing" }]),
    ).toThrow(/no compute named Missing/);
  });

  it("refuses a row naming a parameter its spec does not have", () => {
    expect(() =>
      buildAnalysisCatalog(
        [fakeSpec],
        [{ ...fakeRow, params: { ...fakeRow.params, n_bns: { label: "x" } } }],
      ),
    ).toThrow(/no spec parameter n_bns/);
  });

  it("refuses a required parameter nothing fills", () => {
    expect(() =>
      buildAnalysisCatalog([fakeSpec], [{ ...fakeRow, params: {} }]),
    ).toThrow(/required parameter n_bins/);
  });

  it("refuses an input molvis has no source for", () => {
    const spec: RawSpec = {
      ...fakeSpec,
      inputs: [{ name: "signal", kind: "Scalars", optional: false }],
    };
    expect(() => buildAnalysisCatalog([spec], [fakeRow])).toThrow(
      /no source for input signal/,
    );
  });

  it("refuses a source whose knob the row does not declare", () => {
    const spec: RawSpec = {
      ...fakeSpec,
      inputs: [{ name: "neighbors", kind: "Neighbors", optional: false }],
    };
    expect(() => buildAnalysisCatalog([spec], [fakeRow])).toThrow(
      /neighbor cutoff/,
    );
  });
});

describe("requirement probing", () => {
  it("blocks every analysis when no structure (empty frame) is loaded", () => {
    const empty = new Frame();
    expect(frameHasStructure(empty)).toBe(false);
    expect(frameHasStructure(null)).toBe(false);
    for (const entry of catalog.analyses) {
      const availability = analysisAvailability(empty, entry);
      expect(availability.runnable).toBe(false);
      expect(availability.reason).toContain("no structure");
    }
    empty.free();
  });

  it("blocks a velocity analysis on a positions-only frame and names the columns", () => {
    const frame = positionsOnlyFrame();
    const availability = analysisAvailability(
      frame,
      analysis("transport.vacf"),
    );
    expect(availability.runnable).toBe(false);
    for (const column of ["vx", "vy", "vz"]) {
      expect(availability.reason).toContain(column);
    }
    frame.free();
  });

  it("allows a positions-only analysis on a positions-only frame", () => {
    const frame = positionsOnlyFrame();
    expect(
      analysisAvailability(frame, analysis("density.radial_distribution"))
        .runnable,
    ).toBe(true);
    frame.free();
  });

  it("blocks a cell-bound analysis on a frame without a cell", () => {
    const frame = positionsOnlyFrame(false);
    const availability = analysisAvailability(
      frame,
      analysis("density.gaussian_density"),
    );
    expect(availability.runnable).toBe(false);
    expect(availability.reason).toContain("cell");
    frame.free();
  });

  it("blocks a bond-derived distribution when the frame has no bonds block", () => {
    const frame = positionsOnlyFrame();
    const availability = analysisAvailability(
      frame,
      analysis("distribution.bond_distribution"),
    );
    expect(availability.runnable).toBe(false);
    expect(availability.reason).toContain("`bonds` block");
    frame.free();
  });

  it("reports a descriptor matrix as something the scene cannot derive", () => {
    const frame = positionsOnlyFrame();
    const statuses = probeRequirements(frame, analysis("ml.kmeans"));
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      requirement: "descriptorMatrix",
      satisfied: false,
    });
    frame.free();
  });
});

describe("canonical field convention", () => {
  it("gives each frame-column requirement exactly one column set", () => {
    // molrs `store::keys` is the single source of truth; an alias list here
    // would be a second one.
    const expected: Record<string, string[]> = {
      velocity: ["vx", "vy", "vz"],
      charge: ["charge"],
      dipole: ["mux", "muy", "muz"],
      orientation: ["quatw", "quati", "quatj", "quatk"],
    };
    for (const [requirement, columns] of Object.entries(expected)) {
      const key = requirement as AnalysisRequirement;
      expect(isFrameColumnRequirement(key)).toBe(true);
      expect([...requirementColumns(key)]).toEqual(columns);
    }
  });
});
