import { WasmKMeans, WasmPca2 } from "@molcrafts/molvis-core/molrs";

/**
 * Lloyd-iteration cap for the k-means colour overlay. Fixed in MVP — the
 * 2D embedding converges well inside this many passes.
 */
const KMEANS_MAX_ITER = 100;

/** How to colour the embedded points. Carried through to the UI verbatim. */
export type ExplorationColorBy =
  | { kind: "cluster" }
  | { kind: "label"; name: string }
  | { kind: "frame-index" }
  | { kind: "solid" };

/**
 * Declarative description of one exploration run. Everything needed to
 * reproduce a {@link DatasetExploration} from a `frameLabels` map.
 */
export interface ExplorationConfig {
  /**
   * Names of frame labels to use as descriptors. Each must exist in the
   * `frameLabels` map passed to {@link runExploration}, and at least two are
   * required (PCA needs ≥ 2 columns).
   */
  descriptorNames: string[];
  /** Dimensionality reduction. Only PCA in MVP; the union extends in v2. */
  reduction: { method: "pca" };
  /** Optional clustering overlay. `none` disables the cluster colour mode. */
  clustering:
    | { method: "kmeans"; k: number; seed: number }
    | { method: "none" };
  /** Initial colour mode at compute time. Live recolouring is a UI concern. */
  colorBy: ExplorationColorBy;
}

/**
 * Immutable result of one {@link runExploration} call. Stored on
 * `System.exploration` and invalidated whenever the trajectory changes.
 */
export interface DatasetExploration {
  /** The config that produced this result. */
  config: ExplorationConfig;
  /** The stacked descriptor matrix that was fed to PCA. */
  descriptors: {
    names: string[];
    /** Row-major `[nFrames * nDescriptors]`. */
    values: Float64Array;
    nFrames: number;
    nDescriptors: number;
  };
  /** The 2D PCA embedding. */
  embedding: {
    /** Row-major `[nFrames * 2]`. */
    coords: Float64Array;
    /** Explained variance per component, descending. */
    variance: [number, number];
    /** Display labels, e.g. `["PC1 (42.3%)", "PC2 (18.1%)"]`. */
    axes: [string, string];
  };
  /** Per-frame cluster ids, or `null` when clustering is disabled. */
  clusters: Int32Array | null;
  /** `performance.now()` at completion — lets the UI detect fresh results. */
  computedAt: number;
}

/** `PC{i+1} (xx.x%)` once the total variance is known, bare label otherwise. */
function formatAxis(variance: number, total: number, index: number): string {
  const label = `PC${index + 1}`;
  if (!Number.isFinite(total) || total <= 0) return label;
  return `${label} (${((variance / total) * 100).toFixed(1)}%)`;
}

/**
 * Project the selected frame labels to 2D via PCA, optionally overlaying a
 * k-means clustering of the embedding.
 *
 * The label columns are already materialised as `Float64Array`s at trajectory
 * load (see {@link aggregateFrameLabels}), so this orchestrator only stacks
 * the selected columns into a row-major matrix and hands it to molrs. No
 * per-frame iteration and no WASM analyzer-per-frame.
 *
 * Throws when fewer than two descriptors are selected, when a named descriptor
 * is missing from `frameLabels`, or when any selected column contains a
 * non-finite value (callers must filter or impute beforehand). WASM handles
 * are always freed before returning.
 */
export function runExploration(
  frameLabels: Map<string, Float64Array>,
  config: ExplorationConfig,
): DatasetExploration {
  const names = config.descriptorNames;
  const nDescriptors = names.length;
  if (nDescriptors < 2) {
    throw new Error("PCA needs at least 2 descriptors");
  }

  const columns = names.map((name) => {
    const column = frameLabels.get(name);
    if (!column) throw new Error(`Unknown descriptor "${name}"`);
    return column;
  });

  const nFrames = columns[0].length;
  for (let j = 0; j < nDescriptors; j++) {
    if (columns[j].length !== nFrames) {
      throw new Error(`Descriptor "${names[j]}" length mismatch`);
    }
  }
  if (nFrames < 3) {
    throw new Error("PCA needs at least 3 frames");
  }

  // Stack the selected columns into a row-major [nFrames * nDescriptors]
  // matrix, rejecting NaNs eagerly with a precise message.
  const values = new Float64Array(nFrames * nDescriptors);
  for (let j = 0; j < nDescriptors; j++) {
    const column = columns[j];
    for (let i = 0; i < nFrames; i++) {
      const v = column[i];
      if (!Number.isFinite(v)) {
        throw new Error(
          `Descriptor "${names[j]}" has a non-finite value at frame ${i}`,
        );
      }
      values[i * nDescriptors + j] = v;
    }
  }

  let coords: Float64Array;
  let variance: [number, number];
  const pca = new WasmPca2();
  try {
    const result = pca.fitTransform(values, nFrames, nDescriptors);
    try {
      coords = result.coords();
      const v = result.variance();
      variance = [v[0], v[1]];
    } finally {
      result.free();
    }
  } finally {
    pca.free();
  }

  let clusters: Int32Array | null = null;
  if (config.clustering.method === "kmeans") {
    const { k, seed } = config.clustering;
    const km = new WasmKMeans(k, KMEANS_MAX_ITER, seed);
    try {
      clusters = km.fit(coords, nFrames, 2);
    } finally {
      km.free();
    }
  }

  const total = variance[0] + variance[1];
  const axes: [string, string] = [
    formatAxis(variance[0], total, 0),
    formatAxis(variance[1], total, 1),
  ];

  return {
    config,
    descriptors: { names: [...names], values, nFrames, nDescriptors },
    embedding: { coords, variance, axes },
    clusters,
    computedAt: performance.now(),
  };
}
