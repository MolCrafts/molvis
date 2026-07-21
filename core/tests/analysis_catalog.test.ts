import * as molrs from "@molcrafts/molrs";
import { Block, Box, Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  type AnalysisRequirement,
  defaultAnalysisParams,
  getAnalysisCatalog,
  isFrameColumnRequirement,
  listAnalysisCategoriesWithEntries,
  requirementColumns,
} from "../src/analysis/registry";
import {
  analysisAvailability,
  frameHasStructure,
  probeRequirements,
  requirementSource,
} from "../src/analysis/requirements";

/**
 * The catalog is the single source of truth shared with molrs-wasm. These tests
 * pin the contract that made the old hand-written registry drift: every entry
 * must name a binding that exists, and its `ctor` params must really construct.
 */

const catalog = getAnalysisCatalog();

function moduleExport(name: string): unknown {
  return (molrs as unknown as Record<string, unknown>)[name];
}

/** A minimal periodic frame: positions only, no velocities, no bonds. */
function positionsOnlyFrame(): Frame {
  const block = new Block();
  block.setColF("x", new Float64Array([0, 1, 2]));
  block.setColF("y", new Float64Array([0, 0, 0]));
  block.setColF("z", new Float64Array([0, 0, 0]));
  block.setColStr("element", ["C", "C", "O"]);
  const frame = new Frame();
  frame.insertBlock("atoms", block);
  frame.box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);
  return frame;
}

describe("molrs compute catalog", () => {
  it("declares every category it uses, and uses every category it declares", () => {
    const declared = new Set(catalog.categories.map((entry) => entry.id));
    const used = new Set(catalog.analyses.map((entry) => entry.category));
    expect([...used].filter((id) => !declared.has(id))).toEqual([]);
    expect([...declared].filter((id) => !used.has(id))).toEqual([]);
  });

  it("covers freud-aligned molrs compute categories", () => {
    // Catalog v3: freud core + molrs extensions. dynamics→transport,
    // static dielectric→spectroscopy, cluster_properties→cluster.
    expect(catalog.categories).toHaveLength(15);
    const ids = catalog.categories.map((c) => c.id);
    expect(ids).toEqual([
      "density",
      "locality",
      "msd",
      "cluster",
      "order",
      "environment",
      "diffraction",
      "pmft",
      "transport",
      "spectroscopy",
      "hbond",
      "distribution",
      "shape",
      "fit",
      "ml",
    ]);
    expect(ids).not.toContain("rdf");
    expect(ids).not.toContain("voronoi");
    expect(ids).not.toContain("dynamics");
    expect(ids).not.toContain("dielectric");

    const byId = Object.fromEntries(
      catalog.analyses.map((a) => [a.id, a.category]),
    );
    expect(byId["rdf.radial_distribution"]).toBe("density");
    expect(byId["voronoi.radical_voronoi"]).toBe("locality");
    expect(byId["dynamics.van_hove_function"]).toBe("transport");
    expect(byId["dynamics.pair_persistence"]).toBe("transport");
    expect(byId["dielectric.static_dielectric_constant"]).toBe("spectroscopy");
    expect(byId["shape.cluster_properties"]).toBe("cluster");

    expect(listAnalysisCategoriesWithEntries()).toHaveLength(15);
  });

  it("never names a binding molrs does not export", () => {
    const missing = catalog.analyses
      .filter(
        (analysis) => typeof moduleExport(analysis.wasmExport) !== "function",
      )
      .map((analysis) => `${analysis.id} -> ${analysis.wasmExport}`);
    expect(missing).toEqual([]);
  });

  it("has no duplicate analysis ids", () => {
    const ids = catalog.analyses.map((analysis) => analysis.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("exposes PMFT and Voronoi, which used to be build-time placeholders", () => {
    const ids = new Set(catalog.analyses.map((analysis) => analysis.id));
    for (const id of [
      "pmft.pmft_r12",
      "pmft.pmft_xy",
      "pmft.pmft_xyt",
      "pmft.pmft_xyz",
      "voronoi.radical_voronoi",
      "voronoi.domain_analysis",
      "voronoi.void_analysis",
      "distribution.combined_distribution",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});

describe("catalog parameter slots", () => {
  it("labels every parameter ctor or call", () => {
    for (const analysis of catalog.analyses) {
      for (const param of analysis.params) {
        expect(["ctor", "call"]).toContain(param.slot);
      }
    }
  });

  it("only ever marks another object's knob as call-slot", () => {
    // molrs bindings are constructor-configured: `compute`/`fit` take data
    // only. So a `call` param must belong to a helper the dispatcher builds —
    // LinkedCell's cutoff, Cluster's min size, an upstream flux resolution, or
    // the column `labelBy` turns into a `labels` argument. Anything else here
    // means a binding regressed to functional-style configuration.
    const allowed = new Set([
      "cutoff",
      "minClusterSize",
      "resolution",
      "labelBy",
    ]);
    const stray = catalog.analyses.flatMap((analysis) =>
      analysis.params
        .filter((param) => param.slot === "call" && !allowed.has(param.key))
        .map((param) => `${analysis.id}.${param.key}`),
    );
    expect(stray).toEqual([]);
  });

  it("constructs every frame-driven binding from its ctor-slot defaults", () => {
    const shapes = new Set(["frame", "frameNeighbors", "frameGroups"]);
    const failures: string[] = [];

    for (const analysis of catalog.analyses) {
      if (!shapes.has(analysis.inputKind)) continue;

      const defaults = defaultAnalysisParams(analysis);
      const args = analysis.params
        .filter((param) => param.slot === "ctor")
        .map((param) => {
          const value = defaults[param.key];
          if (param.kind === "intList") {
            return new Uint32Array(String(value).split(",").map(Number));
          }
          if (param.kind === "floatList") {
            return new Float64Array(String(value).split(",").map(Number));
          }
          if (param.kind === "textList") return String(value).split(",");
          return value;
        });

      try {
        const Ctor = moduleExport(analysis.wasmExport) as new (
          ...a: unknown[]
        ) => { free?: () => void };
        new Ctor(...args).free?.();
      } catch (error) {
        failures.push(`${analysis.id}: ${(error as Error).message ?? error}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("requirement probing", () => {
  it("blocks every analysis when no structure (empty frame) is loaded", () => {
    const empty = new Frame();
    expect(frameHasStructure(empty)).toBe(false);
    expect(frameHasStructure(null)).toBe(false);
    for (const analysis of catalog.analyses.slice(0, 12)) {
      const availability = analysisAvailability(empty, analysis);
      expect(availability.runnable).toBe(false);
      expect(availability.reason).toContain("no structure");
    }
    empty.free();
  });

  it("blocks a velocity analysis on a positions-only frame and names the columns", () => {
    const frame = positionsOnlyFrame();
    const vacf = catalog.analyses.find((a) => a.id === "transport.vacf");
    if (!vacf) throw new Error("transport.vacf missing from catalog");

    const availability = analysisAvailability(frame, vacf);
    expect(availability.runnable).toBe(false);
    expect(availability.reason).toContain("vx");
    expect(availability.reason).toContain("vy");
    expect(availability.reason).toContain("vz");
    frame.free();
  });

  it("allows a positions-only analysis on a positions-only frame", () => {
    const frame = positionsOnlyFrame();
    const rdf = catalog.analyses.find(
      (a) => a.id === "rdf.radial_distribution",
    );
    if (!rdf) throw new Error("rdf.radial_distribution missing from catalog");

    expect(analysisAvailability(frame, rdf).runnable).toBe(true);
    frame.free();
  });

  it("blocks a bond-derived distribution when the frame has no bonds block", () => {
    const frame = positionsOnlyFrame();
    const angles = catalog.analyses.find(
      (a) => a.id === "distribution.angle_distribution",
    );
    if (!angles) throw new Error("distribution.angle_distribution missing");

    const availability = analysisAvailability(frame, angles);
    expect(availability.runnable).toBe(false);
    expect(availability.reason).toContain("`bonds` block");
    frame.free();
  });

  it("reports an upstream-result requirement as unsatisfiable from a frame", () => {
    const frame = positionsOnlyFrame();
    const lifetime = catalog.analyses.find((a) => a.id === "hbond.lifetime");
    if (!lifetime) throw new Error("hbond.lifetime missing from catalog");

    const statuses = probeRequirements(frame, lifetime);
    expect(statuses.every((status) => status.source === "upstreamResult")).toBe(
      true,
    );
    expect(statuses.every((status) => !status.satisfied)).toBe(true);
    frame.free();
  });

  it("treats PMFT R12 as needing orientations but PMFT XY as not", () => {
    const frame = positionsOnlyFrame();
    const r12 = catalog.analyses.find((a) => a.id === "pmft.pmft_r12");
    const xy = catalog.analyses.find((a) => a.id === "pmft.pmft_xy");
    if (!r12 || !xy) throw new Error("pmft entries missing from catalog");

    const blocked = analysisAvailability(frame, r12);
    expect(blocked.runnable).toBe(false);
    // The canonical quaternion columns, per molrs `store::keys::QUAT`.
    for (const column of ["quatw", "quati", "quatj", "quatk"]) {
      expect(blocked.reason).toContain(`\`${column}\``);
    }
    expect(analysisAvailability(frame, xy).runnable).toBe(true);
    frame.free();
  });

  it("names the canonical charge column, and only that one", () => {
    const frame = positionsOnlyFrame();
    const conductivity = catalog.analyses.find(
      (a) => a.id === "transport.conductivity",
    );
    if (!conductivity) throw new Error("transport.conductivity missing");

    const reason = analysisAvailability(frame, conductivity).reason ?? "";
    expect(reason).toContain("`charge`");
    // `q` is a LAMMPS-native spelling, renamed at the reader boundary. A frame
    // never carries it, so molvis must never probe for it.
    expect(reason).not.toContain("`q`");
    frame.free();
  });
});

describe("canonical field convention", () => {
  it("gives each frame-column requirement exactly one column set", () => {
    // molrs `store::keys` is the single source of truth; an alias list here
    // would be a second one. See `LammpsFieldFormatter` for how format-native
    // spellings are renamed on the way out of a reader.
    const expected: Record<string, string[]> = {
      velocity: ["vx", "vy", "vz"],
      charge: ["charge"],
      dipole: ["mux", "muy", "muz"],
      orientation: ["quatw", "quati", "quatj", "quatk"],
    };
    for (const [requirement, columns] of Object.entries(expected)) {
      const requirementKey = requirement as AnalysisRequirement;
      expect(isFrameColumnRequirement(requirementKey)).toBe(true);
      expect([...requirementColumns(requirementKey)]).toEqual(columns);
    }
  });

  it("does not pretend a per-frame system quantity is an atom column", () => {
    for (const requirement of [
      "magneticDipole",
      "polarizability",
      "gTensor",
    ] as AnalysisRequirement[]) {
      expect(isFrameColumnRequirement(requirement)).toBe(false);
      expect(requirementSource(requirement)).toBe("upstreamResult");
    }
  });
});
