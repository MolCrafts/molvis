/**
 * Catalog analysis ids — the one place `stage/` spells the string that names
 * an analysis.
 *
 * molrs is the Rust molecular core this package computes with, compiled to
 * WASM (WebAssembly, the binary format browsers execute at near-native speed).
 * It ships a *compute catalog*: a machine-readable list of every analysis that
 * build can actually run. Each catalog entry is an `AnalysisDefinition` (see
 * `./registry.ts`), and its `id` field is one of the strings below — goldens
 * copied from `@molcrafts/molrs@^0.13.1`, catalog 0.13.1, read 2026-08-14.
 * `stage/tests/analysis/analysis_ids.test.ts` fails if any of them stops
 * resolving to a catalog entry, which is how a stale constant — and the dead
 * dispatch branch behind it — gets caught.
 *
 * That id is the identity every consumer routes on: main-thread orchestration
 * (`./dispatch.ts`), the worker kernel (`./job_runner.ts`) and the pipeline
 * modifiers (`../pipeline/cluster_pipeline.ts`) import from here instead of
 * repeating the literal, and any UI that routes by analysis should do the same.
 *
 * This is the Wire layer of the analysis package: the tier both the browser
 * main thread and the analysis Web Worker are allowed to import. The full
 * layer table is in `./index.ts`.
 *
 * **Zero imports, deliberately.** That is the whole reason this module can be
 * referenced from a worker kernel, from main-thread orchestration and from a
 * pipeline modifier without coupling any of them to the others. Keep it that
 * way — no registry lookup, no molrs import, no helper.
 */

/**
 * Radial distribution function (RDF), written g(r): how likely you are to find
 * an atom a distance r away from a reference atom, divided by what a uniform
 * fluid of the same average density would give. Peaks mark the preferred
 * neighbor shells around an atom. See `./rdf_params.ts` for the alternative
 * presentations (raw pair counts, shell density) molvis offers.
 */
export const RDF_ANALYSIS_ID = "rdf.radial_distribution";

/**
 * Mean squared displacement (MSD): the average squared distance each atom has
 * travelled away from a reference frame, accumulated frame by frame. How fast
 * it grows with time is the usual route to a diffusion coefficient.
 */
export const MSD_ANALYSIS_ID = "msd.mean_squared_displacement";

/**
 * Connected-components clustering: draw an edge between every pair of atoms
 * closer together than a cutoff distance, then report each connected piece of
 * that graph as one cluster (a droplet, a micelle, a fragment). The pipeline's
 * own clustering (`./cluster.ts`'s `computeClusters`) can build those edges
 * from bonds instead; the catalog binding this id names always links by
 * distance.
 */
export const CLUSTER_ANALYSIS_ID = "cluster.connected_components";

/**
 * Center of mass (COM) of each cluster — the average atom position weighted by
 * mass. Drives the `Center of mass` pipeline modifier via
 * `../pipeline/cluster_pipeline.ts`'s `isComAnalysisId`.
 */
export const COM_ANALYSIS_ID = "shape.center_of_mass";

/**
 * Per-cluster shape properties in one call: geometric centers, centers of
 * mass, cluster masses, gyration and inertia tensors, and radii of gyration
 * (see `./cluster_properties.ts` for the result fields). The radius of
 * gyration — the mass-weighted root-mean-square distance of a cluster's atoms
 * from its center of mass, i.e. how spread out the cluster is — is the one
 * molvis surfaces, hence the `RG_` name on an id the catalog spells more
 * broadly. Drives the `Radius of gyration` pipeline modifier via
 * `../pipeline/cluster_pipeline.ts`'s `isRgAnalysisId`.
 */
export const RG_ANALYSIS_ID = "shape.cluster_properties";

/**
 * Power spectrum of the velocity autocorrelation function (VACF — how much an
 * atom's velocity at one instant still resembles its velocity a time t later).
 * The frequency spectrum of that decay is the vibrational density of states:
 * how much of the atoms' motion sits at each vibration frequency.
 */
export const POWER_SPECTRUM_ANALYSIS_ID = "spectroscopy.power_spectrum";

/**
 * Radical (Laguerre) Voronoi tessellation. A Voronoi tessellation cuts space
 * into one cell per atom, each cell holding the points closest to that atom;
 * the radical variant offsets every distance by the atom's radius, so large
 * atoms claim proportionally larger cells. Cell volumes and face counts are
 * the usual measures of local packing.
 */
export const VORONOI_RADICAL_ANALYSIS_ID = "voronoi.radical_voronoi";

/**
 * Voronoi domain analysis: the same tessellation, but every cell also carries
 * an integer label taken from an atom column chosen at run time (the `labelBy`
 * parameter, resolved by `./panel_inputs.ts`'s `atomLabels`), so that touching
 * cells with equal labels are read as one domain — a grain, a phase, a
 * molecule.
 */
export const VORONOI_DOMAIN_ANALYSIS_ID = "voronoi.domain_analysis";

/**
 * Voronoi void analysis — the empty space between atoms (pores, cavities)
 * rather than the atoms themselves. Alongside the frame the caller passes a
 * `0/1` probe mask over all atoms, built from the current selection by
 * `./panel_inputs.ts`'s `voidMask`.
 */
export const VORONOI_VOID_ANALYSIS_ID = "voronoi.void_analysis";
