import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import {
  CLUSTER_ANALYSIS_ID,
  COM_ANALYSIS_ID,
  MSD_ANALYSIS_ID,
  POWER_SPECTRUM_ANALYSIS_ID,
  RDF_ANALYSIS_ID,
  RG_ANALYSIS_ID,
  VORONOI_DOMAIN_ANALYSIS_ID,
  VORONOI_RADICAL_ANALYSIS_ID,
  VORONOI_VOID_ANALYSIS_ID,
} from "../../src/analysis/analysis_ids";
import { getAnalysisDefinition } from "../../src/analysis/registry";

/**
 * `analysis_ids.ts` is the Wire-layer name table for the molrs compute catalog.
 * The literals below are hard-coded goldens (source: molrs compute catalog
 * 0.13.1, `@molcrafts/molrs@^0.13.1`, 2026-08-14) — this file must never derive
 * an expectation from the module under test, or the golden proves nothing.
 */

/** Every id the module publishes, assembled here rather than imported. */
const ALL_IDS: readonly string[] = [
  RDF_ANALYSIS_ID,
  MSD_ANALYSIS_ID,
  CLUSTER_ANALYSIS_ID,
  COM_ANALYSIS_ID,
  RG_ANALYSIS_ID,
  POWER_SPECTRUM_ANALYSIS_ID,
  VORONOI_RADICAL_ANALYSIS_ID,
  VORONOI_DOMAIN_ANALYSIS_ID,
  VORONOI_VOID_ANALYSIS_ID,
];

describe("TestAnalysisIds", () => {
  it("RDF_ANALYSIS_ID is the catalog rdf id", () => {
    expect(RDF_ANALYSIS_ID).toBe("rdf.radial_distribution");
  });

  it("MSD_ANALYSIS_ID is the catalog msd id", () => {
    expect(MSD_ANALYSIS_ID).toBe("msd.mean_squared_displacement");
  });

  it("CLUSTER_ANALYSIS_ID is the catalog connected-components id", () => {
    expect(CLUSTER_ANALYSIS_ID).toBe("cluster.connected_components");
  });

  it("COM_ANALYSIS_ID is the catalog centre-of-mass id", () => {
    expect(COM_ANALYSIS_ID).toBe("shape.center_of_mass");
  });

  it("RG_ANALYSIS_ID is the catalog cluster-properties id", () => {
    expect(RG_ANALYSIS_ID).toBe("shape.cluster_properties");
  });

  it("POWER_SPECTRUM_ANALYSIS_ID is the catalog power-spectrum id", () => {
    expect(POWER_SPECTRUM_ANALYSIS_ID).toBe("spectroscopy.power_spectrum");
  });

  it("VORONOI_RADICAL_ANALYSIS_ID is the catalog radical-voronoi id", () => {
    expect(VORONOI_RADICAL_ANALYSIS_ID).toBe("voronoi.radical_voronoi");
  });

  it("VORONOI_DOMAIN_ANALYSIS_ID is the catalog domain-analysis id", () => {
    expect(VORONOI_DOMAIN_ANALYSIS_ID).toBe("voronoi.domain_analysis");
  });

  it("VORONOI_VOID_ANALYSIS_ID is the catalog void-analysis id", () => {
    expect(VORONOI_VOID_ANALYSIS_ID).toBe("voronoi.void_analysis");
  });

  it("publishes nine pairwise-distinct ids (copy-paste guard)", () => {
    expect(ALL_IDS).toHaveLength(9);
    expect(new Set(ALL_IDS).size).toBe(9);
  });

  it("every id resolves to a molrs catalog definition", () => {
    // A miss here means dispatch carries a dead branch: the catalog no longer
    // knows this id. Fix the constant or the branch — never weaken this gate.
    const missing = ALL_IDS.filter(
      (id) => getAnalysisDefinition(id) === undefined,
    );
    expect(missing).toEqual([]);
  });
});
