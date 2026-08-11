/**
 * MolPy handbook URLs for molvis chrome.
 *
 * Prefer a short {@link DocsLink} over in-panel lectures. Path fragments are
 * relative to the molpy product root on docs.molcrafts.org.
 */

export const MOLPY_DOCS_ORIGIN = "https://docs.molcrafts.org/molpy";

/** Absolute handbook URL from a path under the molpy product root. */
export function molpyDocsUrl(path: string): string {
  const clean = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return clean ? `${MOLPY_DOCS_ORIGIN}/${clean}/` : `${MOLPY_DOCS_ORIGIN}/`;
}

/** Compute index (fallback when a specific analysis page is unknown). */
export const MOLPY_COMPUTE_INDEX = molpyDocsUrl("compute");

/** Geometry optimization guide (structure optimizer panel). */
export const MOLPY_OPTIMIZE_DOCS = molpyDocsUrl(
  "user-guide/08_geometry_optimization",
);

/** Box / PBC tutorial. */
export const MOLPY_BOX_DOCS = molpyDocsUrl("tutorials/03_box_and_periodicity");

/** Cluster analysis. */
export const MOLPY_CLUSTER_DOCS = molpyDocsUrl("compute/cluster");

/**
 * Catalog analysis id → handbook path under `compute/…` (or other molpy root).
 * Unknown ids fall back to the compute index.
 */
const ANALYSIS_DOC_PATH: Readonly<Record<string, string>> = {
  "rdf.radial_distribution": "compute/rdf",
  "msd.mean_squared_displacement": "compute/msd",
  "transport.vacf": "compute/vacf",
  "transport.einstein_diffusion": "compute/msd",
  "transport.green_kubo_diffusion": "compute/vacf",
  "transport.conductivity": "compute/pmsd",
  "transport.einstein_conductivity": "compute/pmsd",
  "transport.onsager_correlation": "compute/onsager",
  "dynamics.van_hove_function": "compute/van_hove",
  "dynamics.pair_persistence": "compute/persist",
  "spectroscopy.power_spectrum": "compute/spectra",
  "spectroscopy.ir_spectrum": "compute/spectra",
  "spectroscopy.raman_spectrum": "compute/spectra",
  "order.rotational_autocorrelation": "compute/reorientation",
  "hbond.lifetime": "compute/hbond",
  "distribution.angle_distribution": "compute/distribution",
  "distribution.combined_distribution": "compute/distribution",
  "distribution.distance_distribution": "compute/distribution",
  "distribution.dihedral_distribution": "compute/distribution",
  "cluster.connected_components": "compute/cluster",
  "topology.rings": "tutorials/01_atomistic_and_topology",
  // Product-only Rings panel id (useAnalysisCatalog).
  "molvis.rings": "tutorials/01_atomistic_and_topology",
};

/** Prefix → path when the full id is not listed. */
const ANALYSIS_PREFIX_PATH: ReadonlyArray<readonly [string, string]> = [
  ["rdf.", "compute/rdf"],
  ["msd.", "compute/msd"],
  ["transport.", "compute"],
  ["dynamics.", "compute"],
  ["spectroscopy.", "compute/spectra"],
  ["order.", "compute/order"],
  ["hbond.", "compute/hbond"],
  ["distribution.", "compute/distribution"],
  ["cluster.", "compute/cluster"],
  ["decomposition.", "compute/decomposition"],
  ["shape.", "compute/shape"],
  ["environment.", "compute/environment"],
  ["spatial.", "compute/spatial"],
];

/** Resolve handbook URL for a compute catalog / panel analysis id. */
export function molpyDocsForAnalysis(analysisId: string): string {
  const exact = ANALYSIS_DOC_PATH[analysisId];
  if (exact) return molpyDocsUrl(exact);
  for (const [prefix, path] of ANALYSIS_PREFIX_PATH) {
    if (analysisId.startsWith(prefix)) return molpyDocsUrl(path);
  }
  return MOLPY_COMPUTE_INDEX;
}

/**
 * Modifier display name → handbook path. Keep product names as used in the
 * pipeline registry (`modifier.name`).
 */
const MODIFIER_DOC_PATH: Readonly<Record<string, string>> = {
  "Create bonds": "tutorials/01_atomistic_and_topology",
  "Simulation cell": "tutorials/03_box_and_periodicity",
  "Wrap PBC": "tutorials/03_box_and_periodicity",
  "Unwrap trajectories": "tutorials/03_box_and_periodicity",
  Cluster: "compute/cluster",
  "Center of mass": "compute/shape",
  "Radius of gyration": "compute/shape",
  "Steinhardt order": "compute/order",
  "Solid-liquid": "compute/order",
  "Coordination polyhedra": "compute/environment",
  "Gaussian density surface": "compute/density",
  "Vector field": "compute",
  "Smooth trajectory": "tutorials/05_trajectory",
  "Generate trajectory lines": "tutorials/05_trajectory",
};

/** Handbook URL for a pipeline modifier, or null when no page is mapped. */
export function molpyDocsForModifier(modifierName: string): string | null {
  const path = MODIFIER_DOC_PATH[modifierName];
  return path ? molpyDocsUrl(path) : null;
}
