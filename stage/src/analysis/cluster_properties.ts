import {
  type Frame,
  CenterOfMass as WasmCenterOfMass,
  type CenterOfMassResult as WasmCenterOfMassResult,
  type ClusterResult as WasmClusterResult,
  GyrationTensor as WasmGyrationTensor,
  type GyrationTensorResult as WasmGyrationTensorResult,
  InertiaTensor as WasmInertiaTensor,
  type InertiaTensorResult as WasmInertiaTensorResult,
} from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";

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

/** A result-handle array field as `toJSON()` spells it. */
interface WireArray {
  data: number[];
}

/**
 * Atom positions as the flat `N × 3` array molrs `compute` takes.
 *
 * @throws Error when the frame has no atom coordinates
 */
function flatPositions(frame: Frame): Float64Array {
  const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
  const coords = atoms ? viewAtomCoords(atoms) : undefined;
  if (!atoms || !coords) {
    throw new Error("cluster properties: the frame has no atom coordinates");
  }
  const n = atoms.nRows;
  const positions = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[3 * i] = coords.x[i];
    positions[3 * i + 1] = coords.y[i];
    positions[3 * i + 2] = coords.z[i];
  }
  return positions;
}

/**
 * Compute structural properties for each cluster.
 *
 * All computation is delegated to WASM: `CenterOfMass` (uniform masses for the
 * geometric centers, `params.masses` for the centers of mass), `GyrationTensor`
 * (unweighted tensors; mass-weighted for the radius of gyration) and
 * `InertiaTensor`. `clusterResult` is the handle a molrs `Cluster.compute`
 * returned — it is the partition every call groups atoms by, and stays the
 * caller's to free.
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

  const { n_clusters: numClusters } = clusterResult.toJSON() as {
    n_clusters: number;
  };
  const positions = flatPositions(frame);
  const nAtoms = positions.length / 3;
  const uniform = new Float64Array(nAtoms).fill(1);
  const masses = params.masses ?? uniform;
  if (masses.length !== nAtoms) {
    throw new Error(
      `cluster properties: ${masses.length} masses for ${nAtoms} atoms`,
    );
  }

  // `frame.box` hands back an owned copy; molrs borrows it through `clone()`.
  const simbox = frame.box;
  const input = (weights: Float64Array, key: "masses" | "weights") => ({
    positions,
    ...(simbox ? { simbox } : {}),
    partition: clusterResult,
    [key]: weights,
  });

  const centerOfMass = (
    weights: Float64Array,
  ): { centers: Float64Array; masses: Float64Array } => {
    const calc = new WasmCenterOfMass();
    let out: WasmCenterOfMassResult | null = null;
    try {
      out = calc.compute(input(weights, "masses"));
      const data = out.toJSON() as {
        centers: WireArray;
        total_masses: WireArray;
      };
      return {
        centers: Float64Array.from(data.centers.data),
        masses: Float64Array.from(data.total_masses.data),
      };
    } finally {
      out?.free();
      calc.free();
    }
  };

  const gyration = (
    weights: Float64Array,
  ): { tensors: Float64Array; radii: Float64Array } => {
    const calc = new WasmGyrationTensor();
    let out: WasmGyrationTensorResult | null = null;
    try {
      out = calc.compute(input(weights, "weights"));
      const data = out.toJSON() as { tensors: WireArray };
      return {
        tensors: Float64Array.from(data.tensors.data),
        radii: new Float64Array(out.radiusOfGyration()),
      };
    } finally {
      out?.free();
      calc.free();
    }
  };

  try {
    const result: ClusterPropertiesResult = { numClusters };

    if (flags.centers !== false) {
      result.centers = centerOfMass(uniform).centers;
    }
    if (flags.centerOfMass !== false) {
      const com = centerOfMass(masses);
      result.centersOfMass = com.centers;
      result.clusterMasses = com.masses;
    }
    if (flags.radiusOfGyration !== false) {
      result.radiiOfGyration = gyration(masses).radii;
    }
    if (flags.gyrationTensor !== false) {
      result.gyrationTensors = gyration(uniform).tensors;
    }
    if (flags.inertiaTensor !== false) {
      const calc = new WasmInertiaTensor();
      let out: WasmInertiaTensorResult | null = null;
      try {
        out = calc.compute(input(masses, "masses"));
        const data = out.toJSON() as { tensors: WireArray };
        result.inertiaTensors = Float64Array.from(data.tensors.data);
      } finally {
        out?.free();
        calc.free();
      }
    }
    return result;
  } finally {
    simbox?.free();
  }
}
