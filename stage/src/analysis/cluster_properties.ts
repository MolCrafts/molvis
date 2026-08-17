import {
  type Frame,
  CenterOfMass as WasmCenterOfMass,
  type CenterOfMassResult as WasmCenterOfMassResult,
  ClusterCenters as WasmClusterCenters,
  type ClusterResult as WasmClusterResult,
  GyrationTensor as WasmGyrationTensor,
  InertiaTensor as WasmInertiaTensor,
  RadiusOfGyration as WasmRadiusOfGyration,
} from "@molcrafts/molvis-core/molrs";

export interface ClusterPropertiesParams {
  /** Per-particle masses. If omitted, uniform mass (1.0) is used. */
  masses?: Float64Array;
  /** Which properties to compute. Default: all. */
  compute?: {
    centers?: boolean;
    centerOfMass?: boolean;
    radiusOfGyration?: boolean;
    gyrationTensor?: boolean;
    inertiaTensor?: boolean;
  };
}

export interface ClusterPropertiesResult {
  /** Geometric centers [x0,y0,z0, x1,y1,z1, ...] (MIC-aware). */
  centers?: Float64Array;
  /** Mass-weighted centers of mass [x0,y0,z0, ...]. */
  centersOfMass?: Float64Array;
  /** Total mass per cluster. */
  clusterMasses?: Float64Array;
  /** Radius of gyration per cluster. */
  radiiOfGyration?: Float64Array;
  /** Gyration tensors [g00,g01,...g22, ...] (9 floats per cluster). */
  gyrationTensors?: Float64Array;
  /** Inertia tensors [I00,I01,...I22, ...] (9 floats per cluster). */
  inertiaTensors?: Float64Array;
  /** Number of clusters analyzed. */
  numClusters: number;
}

/**
 * Compute structural properties for each cluster.
 *
 * All computation is delegated to WASM. Requires a Frame and a WASM ClusterResult
 * (from the Cluster.compute() call).
 */
export function computeClusterProperties(
  frame: Frame,
  clusterResult: WasmClusterResult,
  params: ClusterPropertiesParams = {},
): ClusterPropertiesResult {
  const flags = params.compute ?? {
    centers: true,
    centerOfMass: true,
    radiusOfGyration: true,
    gyrationTensor: true,
    inertiaTensor: true,
  };

  const result: ClusterPropertiesResult = {
    numClusters: clusterResult.numClusters,
  };

  if (flags.centers !== false) {
    let calc: WasmClusterCenters | null = null;
    try {
      calc = new WasmClusterCenters();
      result.centers = new Float64Array(calc.compute(frame, clusterResult));
    } finally {
      calc?.free();
    }
  }

  if (flags.centerOfMass !== false) {
    let calc: WasmCenterOfMass | null = null;
    let comResult: WasmCenterOfMassResult | null = null;
    try {
      calc = new WasmCenterOfMass(params.masses ?? null);
      comResult = calc.compute(frame, clusterResult);
      result.centersOfMass = new Float64Array(comResult.centersOfMass());
      result.clusterMasses = new Float64Array(comResult.clusterMasses());
    } finally {
      comResult?.free();
      calc?.free();
    }
  }

  if (flags.radiusOfGyration !== false) {
    let calc: WasmRadiusOfGyration | null = null;
    try {
      calc = new WasmRadiusOfGyration(params.masses ?? null);
      result.radiiOfGyration = new Float64Array(
        calc.compute(frame, clusterResult),
      );
    } finally {
      calc?.free();
    }
  }

  if (flags.gyrationTensor !== false) {
    let calc: WasmGyrationTensor | null = null;
    try {
      calc = new WasmGyrationTensor();
      result.gyrationTensors = new Float64Array(
        calc.compute(frame, clusterResult),
      );
    } finally {
      calc?.free();
    }
  }

  if (flags.inertiaTensor !== false) {
    let calc: WasmInertiaTensor | null = null;
    try {
      calc = new WasmInertiaTensor(params.masses ?? null);
      result.inertiaTensors = new Float64Array(
        calc.compute(frame, clusterResult),
      );
    } finally {
      calc?.free();
    }
  }

  return result;
}
