/**
 * molvis's half of the analysis catalog: how each molrs compute is presented
 * and fed. molrs's half is `ComputeSpec.all()`; `./registry` joins the two on
 * `(spec.name, param.name)` and refuses a row that names anything molrs does
 * not have.
 *
 * A row holds only what molrs cannot know: the picker id, category and label,
 * the result renderer, display labels / units / ranges for the spec
 * parameters it presents (a default only where the core has none), the `call`
 * knobs that configure what molvis builds to feed the compute, and — where the
 * default is not what molvis wants — which source fills an input. Kinds,
 * defaults the core has and required-ness come from the spec.
 *
 * Zero imports on purpose: this is data, readable by the registry, the tests
 * and a reviewer without a WASM module in sight.
 */

/**
 * Where molvis reads one `compute` input. Each is implemented once, in
 * `./compute_inputs`.
 *
 * Per frame: `positions` (atom x/y/z), `box` (the frame's cell), `boxVolume`
 * (its volume), `neighbors` (a neighbor table at the row's cutoff),
 * `clusters` (a `Cluster` partition at `cutoff` / `min_cluster_size`),
 * `labels` (an atom column interned to labels, `label_by`), `masses` (the
 * `mass` column, or 1), `radii` (covalent radii, or 1, `use_atom_radii`),
 * `bondTuples` (pairs / angles / dihedrals off the bonds block, by the
 * `observable` parameter), `voidMask` (the selection as a 0/1 mask),
 * `voronoiCells` (a `RadicalVoronoi` of the frame), `qlm` (the `Steinhardt`
 * q_lm table of order `l`), `timestep` (the `dt` knob).
 *
 * Across frames: `positionTrajectory` (x/y/z stacked frame by frame),
 * `velocitySeries` (vx/vy/vz stacked), `velocityAcf` (the `Vacf` of that
 * series, at `max_lag`).
 *
 * Not from a frame: `descriptors` (a feature matrix a panel assembles) — an
 * analysis fed by it is presented but blocked on `descriptorMatrix`.
 */
export type InputSource =
  | "positions"
  | "box"
  | "boxVolume"
  | "neighbors"
  | "clusters"
  | "labels"
  | "masses"
  | "radii"
  | "bondTuples"
  | "voidMask"
  | "voronoiCells"
  | "qlm"
  | "timestep"
  | "positionTrajectory"
  | "velocitySeries"
  | "velocityAcf"
  | "descriptors";

/** Presentation of one spec parameter. */
export interface ParamRow {
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  /** Only where the core has no default (a required parameter). */
  default?: number | boolean | string;
}

/** A molvis-owned knob (`call` slot). */
export interface CallParamRow {
  key: string;
  label: string;
  kind: "int" | "float" | "bool" | "select";
  default: number | boolean | string;
  min?: number;
  max?: number;
  unit?: string;
  options?: string[];
}

export interface AnalysisRow {
  /** Picker / routing id — stable across molrs releases. */
  id: string;
  /** `ComputeSpec` name. */
  spec: string;
  category: string;
  label: string;
  resultKind:
    | "lineSeries"
    | "barSeries"
    | "trajectorySeries"
    | "table"
    | "matrix"
    | "grid3"
    | "scalar"
    | "custom";
  /** Constructor form when not `new` (a static factory named by the spec). */
  ctor?: string;
  /** Presented spec parameters, by spec name. */
  params?: Record<string, ParamRow>;
  /** Spec parameters molvis fills at run time (`max_lag` from the frames). */
  supplied?: string[];
  call?: CallParamRow[];
  /** Which parameter is the neighbor cutoff, when not the `cutoff` knob. */
  neighborCutoff?: string;
  /** Input sources that differ from the default for their kind. */
  sources?: Record<string, InputSource>;
}

const cutoff = (value: number): CallParamRow => ({
  key: "cutoff",
  label: "Neighbor cutoff",
  kind: "float",
  default: value,
  unit: "Å",
});

const minClusterSize: CallParamRow = {
  key: "min_cluster_size",
  label: "Min cluster size",
  kind: "int",
  default: 1,
  min: 1,
  max: 1e6,
};

const useAtomRadii: CallParamRow = {
  key: "use_atom_radii",
  label: "Weight by covalent radii",
  kind: "bool",
  default: true,
};

const timestep: CallParamRow = {
  key: "dt",
  label: "Timestep",
  kind: "float",
  default: 1,
  unit: "fs",
};

const grid = (value: string): ParamRow => ({
  label: "Grid nx, ny, nz",
  default: value,
});

/** Every analysis molvis presents, one row per molrs compute. */
export const ANALYSIS_ROWS: readonly AnalysisRow[] = [
  // --- density -------------------------------------------------------------
  {
    id: "density.radial_distribution",
    spec: "Rdf",
    category: "density",
    label: "Radial distribution g(r)",
    resultKind: "lineSeries",
    neighborCutoff: "r_max",
    params: {
      n_bins: { label: "Bins", min: 1, max: 4096, default: 100 },
      r_max: { label: "r max", unit: "Å", default: 10 },
      r_min: { label: "r min", unit: "Å", default: 0 },
    },
  },
  {
    id: "density.gaussian_density",
    spec: "GaussianDensity",
    category: "density",
    label: "Gaussian density",
    resultKind: "grid3",
    params: {
      dims: grid("32,32,32"),
      sigma: { label: "Sigma", unit: "Å", default: 1 },
    },
  },
  {
    id: "density.local_density",
    spec: "LocalDensity",
    category: "density",
    label: "Local density",
    resultKind: "table",
    neighborCutoff: "r_max",
    params: {
      r_max: { label: "r max", unit: "Å", default: 5 },
      diameter: { label: "Particle diameter", unit: "Å" },
    },
  },
  {
    id: "density.sphere_voxelization",
    spec: "SphereVoxelization",
    category: "density",
    label: "Sphere voxelization",
    resultKind: "grid3",
    params: {
      dims: grid("32,32,32"),
      r_max: { label: "Sphere radius", unit: "Å", default: 2 },
    },
  },
  // --- locality ------------------------------------------------------------
  {
    id: "locality.radical_voronoi",
    spec: "RadicalVoronoi",
    category: "locality",
    label: "Radical Voronoi",
    resultKind: "table",
    call: [useAtomRadii],
  },
  {
    id: "locality.voronoi_domain_analysis",
    spec: "VoronoiDomainAnalysis",
    category: "locality",
    label: "Domain analysis",
    resultKind: "table",
    sources: { partition: "labels" },
    call: [
      useAtomRadii,
      {
        key: "label_by",
        label: "Label cells by",
        kind: "select",
        default: "element",
        options: ["element", "mol_id", "type"],
      },
    ],
  },
  {
    id: "locality.voronoi_void_analysis",
    spec: "VoronoiVoidAnalysis",
    category: "locality",
    label: "Void analysis",
    resultKind: "table",
    call: [useAtomRadii],
  },
  // --- msd -----------------------------------------------------------------
  {
    id: "msd.mean_squared_displacement",
    spec: "Msd",
    sources: { a: "positionTrajectory" },
    category: "msd",
    label: "Mean squared displacement",
    resultKind: "trajectorySeries",
    supplied: ["max_lag"],
    call: [timestep],
  },
  // --- cluster -------------------------------------------------------------
  {
    id: "cluster.connected_components",
    spec: "Cluster",
    category: "cluster",
    label: "Cluster analysis",
    resultKind: "barSeries",
    params: {
      min_cluster_size: { label: "Min cluster size", min: 1, max: 1e6 },
    },
    call: [cutoff(3)],
  },
  // --- order ---------------------------------------------------------------
  {
    id: "order.steinhardt",
    spec: "Steinhardt",
    category: "order",
    label: "Steinhardt",
    resultKind: "matrix",
    params: {
      l: { label: "l values", default: "6" },
      average: { label: "Averaged" },
      wl: { label: "Compute w_l" },
      wl_normalize: { label: "Normalize w_l" },
    },
    call: [cutoff(3)],
  },
  {
    id: "order.hexatic",
    spec: "Hexatic",
    category: "order",
    label: "Hexatic",
    resultKind: "table",
    params: { k: { label: "Symmetry k", min: 1, max: 32, default: 6 } },
    call: [cutoff(3)],
  },
  {
    id: "order.solid_liquid",
    spec: "SolidLiquid",
    category: "order",
    label: "Solid-liquid",
    resultKind: "table",
    params: {
      q_threshold: { label: "q threshold" },
      n_threshold: { label: "Neighbor threshold", min: 0, max: 64 },
      normalize_q: { label: "Normalize q" },
    },
    call: [
      cutoff(3),
      { key: "l", label: "l", kind: "int", default: 6, min: 0, max: 32 },
    ],
  },
  // --- environment ---------------------------------------------------------
  {
    id: "environment.bond_order",
    spec: "BondOrientationalOrder",
    category: "environment",
    label: "Bond order",
    resultKind: "matrix",
    params: {
      n_theta: { label: "θ bins", min: 1, max: 512, default: 60 },
      n_phi: { label: "φ bins", min: 1, max: 512, default: 30 },
    },
    call: [cutoff(3)],
  },
  {
    id: "environment.local_descriptors",
    spec: "LocalDescriptors",
    category: "environment",
    label: "Local descriptors",
    resultKind: "matrix",
    params: { l_max: { label: "l max", min: 0, max: 32, default: 6 } },
    call: [cutoff(3)],
  },
  {
    id: "environment.environment_matching",
    spec: "EnvironmentMatch",
    category: "environment",
    label: "Environment matching",
    resultKind: "table",
    params: {
      rmsd_threshold: { label: "RMSD threshold", unit: "Å", default: 0.1 },
      registration: { label: "Registration" },
      max_neighbors_for_registration: {
        label: "Max neighbors",
        min: 1,
        max: 128,
      },
    },
    call: [cutoff(3)],
  },
  // --- diffraction ---------------------------------------------------------
  {
    id: "diffraction.static_structure_factor",
    spec: "StaticStructureFactorDebye",
    category: "diffraction",
    label: "Static structure factor S(k)",
    resultKind: "lineSeries",
    params: {
      k_values: {
        label: "k values",
        unit: "Å⁻¹",
        default: "0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,6,7,8,9,10",
      },
    },
  },
  {
    id: "diffraction.diffraction_pattern",
    spec: "DiffractionPattern",
    category: "diffraction",
    label: "Diffraction pattern",
    resultKind: "matrix",
    params: {
      n_grid: { label: "Grid", min: 8, max: 4096, default: 512 },
      sigma: { label: "Sigma", default: 1 },
      axis: { label: "Zone axis", min: 0, max: 2 },
    },
  },
  // --- pmft ----------------------------------------------------------------
  {
    id: "pmft.pmft_xy",
    spec: "PmftXy",
    category: "pmft",
    label: "PMFT XY",
    resultKind: "matrix",
    params: {
      x_max: { label: "x max", unit: "Å", default: 5 },
      y_max: { label: "y max", unit: "Å", default: 5 },
      n_x: { label: "x bins", min: 1, max: 1024, default: 50 },
      n_y: { label: "y bins", min: 1, max: 1024, default: 50 },
    },
    call: [cutoff(5)],
  },
  {
    id: "pmft.pmft_xyz",
    spec: "PmftXyz",
    category: "pmft",
    label: "PMFT XYZ",
    resultKind: "matrix",
    params: {
      x_max: { label: "x max", unit: "Å", default: 5 },
      y_max: { label: "y max", unit: "Å", default: 5 },
      z_max: { label: "z max", unit: "Å", default: 5 },
      n_x: { label: "x bins", min: 1, max: 512, default: 30 },
      n_y: { label: "y bins", min: 1, max: 512, default: 30 },
      n_z: { label: "z bins", min: 1, max: 512, default: 30 },
    },
    call: [cutoff(5)],
  },
  // --- transport / spectroscopy -------------------------------------------
  {
    id: "transport.vacf",
    spec: "Vacf",
    sources: { a: "velocitySeries" },
    category: "transport",
    label: "Vacf",
    resultKind: "lineSeries",
    params: {
      max_lag: { label: "Max lag", min: 1, max: 1e6, default: 200 },
      normalization: { label: "Normalization" },
      mean: { label: "Mean" },
    },
    call: [timestep],
  },
  {
    id: "spectroscopy.power_spectrum",
    spec: "Spectrum",
    category: "spectroscopy",
    label: "Power spectrum",
    resultKind: "lineSeries",
    sources: { signal: "velocityAcf" },
    params: {
      window: { label: "Window", default: "hann" },
      pad: { label: "Zero padding", min: 1, max: 64, default: 4 },
    },
    call: [
      timestep,
      {
        key: "max_lag",
        label: "Max lag",
        kind: "int",
        default: 200,
        min: 1,
        max: 1e6,
      },
    ],
  },
  // --- distribution --------------------------------------------------------
  {
    id: "distribution.bond_distribution",
    spec: "DistributionFunction",
    category: "distribution",
    label: "Bond distributions",
    resultKind: "lineSeries",
    params: {
      observable: { label: "Observable", default: "distance" },
      axis: { label: "Range min, max, bins", default: "0, 10, 100" },
    },
  },
  // --- shape ---------------------------------------------------------------
  {
    id: "shape.center_of_mass",
    spec: "CenterOfMass",
    category: "shape",
    label: "Center of mass",
    resultKind: "table",
    call: [cutoff(3), minClusterSize],
  },
  {
    id: "shape.cluster_properties",
    spec: "GyrationTensor",
    category: "shape",
    label: "Radius of gyration",
    resultKind: "table",
    call: [cutoff(3), minClusterSize],
  },
  {
    id: "shape.inertia_tensor",
    spec: "InertiaTensor",
    category: "shape",
    label: "Inertia tensor",
    resultKind: "matrix",
    call: [cutoff(3), minClusterSize],
  },
  // --- ml ------------------------------------------------------------------
  {
    id: "ml.pca",
    spec: "Pca",
    category: "ml",
    label: "PCA",
    resultKind: "custom",
    params: {
      n_components: { label: "Components", min: 1, max: 64, default: 2 },
    },
  },
  {
    id: "ml.kmeans",
    spec: "Kmeans",
    category: "ml",
    label: "k-means",
    resultKind: "custom",
    params: {
      k: { label: "Clusters", min: 1, max: 1024, default: 3 },
      max_iter: { label: "Max iterations", min: 1, max: 1e5 },
    },
  },
];
