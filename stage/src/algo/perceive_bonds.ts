import { toDomainUint } from "@molcrafts/molvis-core";
import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import { PeriodicTable } from "../system/elements";
import {
  isExactOrigin,
  shouldSkipOriginSentinelsForFrame,
} from "../system/occupancy";
import { DType } from "../utils/dtype";
import { SpatialNeighborQuery } from "./neighbor_list";

/** How a pair of atoms is judged to be bonded. */
export type BondCriterion = "distance" | "covalent";

/** Fallback covalent radius (carbon, Å) when an element is unknown. */
const FALLBACK_RADIUS = 0.77;

/**
 * Geometry → bond topology. No pipeline, no modifier, no DOM.
 *
 * Construct → set criterion / cutoffs → {@link PerceiveBonds.apply}.
 * The compute worker uses {@link PerceiveBonds.forForceField}; the pipeline
 * modifier is a thin wrapper around the same object.
 */
export class PerceiveBonds {
  criterion: BondCriterion = "covalent";
  /** Fixed distance cutoff in Å (`distance` criterion). */
  cutoff = 1.8;
  /** Scale on summed covalent radii (`covalent` criterion). */
  tolerance = 1.2;
  /** Lower distance bound in Å; pairs closer than this are rejected. */
  minDistance = 0.4;

  /** True when `frame` has the string `element` column covalent mode needs. */
  static hasElementData(frame: Frame): boolean {
    if (!frame.has("atoms")) return false;
    const atoms = frame.get("atoms");
    return atoms.has("element") && atoms.dtype("element") === DType.String;
  }

  /**
   * Force-field preflight: covalent when `element` exists, else fixed
   * distance. Returns a new frame (caller owns it).
   */
  static forForceField(input: Frame): Frame {
    const job = new PerceiveBonds();
    job.criterion = PerceiveBonds.hasElementData(input)
      ? "covalent"
      : "distance";
    return job.apply(input);
  }

  /**
   * Rebuild `bonds` from geometry. Returns `input` unchanged when there
   * is nothing to perceive; otherwise a new frame with atoms + bonds.
   */
  apply(input: Frame): Frame {
    const atoms = input.has("atoms") ? input.get("atoms") : undefined;
    if (!atoms || atoms.nRows < 2) return input;

    const coords = viewAtomCoords(atoms);
    if (!coords) return input;

    const elements =
      atoms.has("element") && atoms.dtype("element") === DType.String
        ? (atoms.copy("element") as string[])
        : undefined;
    if (this.criterion === "covalent" && !elements) return input;

    const radii = elements
      ? elements.map((el) => PeriodicTable[el]?.radius ?? FALLBACK_RADIUS)
      : undefined;

    const searchCutoff = this.searchCutoff(radii);
    if (searchCutoff <= 0) return input;

    const minSq = this.minDistance * this.minDistance;
    const tol = this.tolerance;
    const fixedSq = this.cutoff * this.cutoff;
    const covalent = this.criterion === "covalent";

    const bondI: number[] = [];
    const bondJ: number[] = [];

    const n = atoms.nRows;
    const dropSentinels = shouldSkipOriginSentinelsForFrame(
      input,
      coords.x,
      coords.y,
      coords.z,
      n,
    );
    // LinkedCell reads literal x/y/z. Only wrapped `x` frames carry the box
    // into the search; unwrapped xu/yu/zu use free boundaries (wrapping
    // invents bonds). When origin sentinels must be dropped, filter them out
    // *before* the search: molpack parks every unplaced atom at exact (0,0,0),
    // so k coincident sentinels land in one cell and generate O(k²) pairs
    // before a per-pair check could discard them.
    const literalXyz = coords.columns.x === "x";
    let searchFrame: Frame;
    let tempFrame: Frame | undefined;
    // Maps a search-frame row back to its original atom index; undefined when
    // the search runs over `input` unfiltered (identity mapping).
    let indexMap: Int32Array | undefined;

    if (!dropSentinels && literalXyz) {
      searchFrame = input;
    } else {
      const included: number[] = [];
      for (let i = 0; i < n; i++) {
        if (
          dropSentinels &&
          isExactOrigin(coords.x[i], coords.y[i], coords.z[i])
        ) {
          continue;
        }
        included.push(i);
      }
      indexMap = Int32Array.from(included);
      const m = included.length;
      const sx = new Float64Array(m);
      const sy = new Float64Array(m);
      const sz = new Float64Array(m);
      for (let k = 0; k < m; k++) {
        const i = included[k];
        sx[k] = coords.x[i];
        sy[k] = coords.y[i];
        sz[k] = coords.z[i];
      }
      tempFrame = new Frame();
      const tempAtoms = new Block();
      tempAtoms.set("x", sx);
      tempAtoms.set("y", sy);
      tempAtoms.set("z", sz);
      tempFrame.set("atoms", tempAtoms);
      // Wrapped coords keep PBC; unwrapped stay free-boundary.
      if (literalXyz) {
        const box = input.box;
        if (box) tempFrame.box = box;
      }
      searchFrame = tempFrame;
    }

    const query = new SpatialNeighborQuery(searchCutoff, {
      distSq: true,
      disp: false,
    });
    let neighbors: ReturnType<SpatialNeighborQuery["build"]> | undefined;
    try {
      neighbors = query.build(searchFrame);
      const iIdx = neighbors.queryPointIndices();
      const jIdx = neighbors.pointIndices();
      const dSq = neighbors.distSq();
      if (!dSq) {
        throw new Error(
          "neighbor table is missing the requested distSq column",
        );
      }
      const pairs = neighbors.nPairs;

      for (let p = 0; p < pairs; p++) {
        const d2 = dSq[p];
        if (d2 < minSq) continue;
        const oi = indexMap ? indexMap[iIdx[p]] : iIdx[p];
        const oj = indexMap ? indexMap[jIdx[p]] : jIdx[p];

        let thresholdSq: number;
        if (covalent && radii) {
          const sum = (radii[oi] + radii[oj]) * tol;
          thresholdSq = sum * sum;
        } else {
          thresholdSq = fixedSq;
        }

        if (d2 <= thresholdSq) {
          bondI.push(oi);
          bondJ.push(oj);
        }
      }
    } finally {
      neighbors?.free();
      query.free();
      tempFrame?.free();
    }

    return PerceiveBonds.withBonds(input, atoms, bondI, bondJ);
  }

  /**
   * Cell-list search radius. Distance uses the fixed cutoff; covalent
   * uses `2 * max(radius) * tolerance`.
   */
  private searchCutoff(radii: number[] | undefined): number {
    if (this.criterion === "distance") return this.cutoff;
    let maxRadius = 0;
    if (radii) {
      for (const r of radii) if (r > maxRadius) maxRadius = r;
    }
    return 2 * maxRadius * this.tolerance;
  }

  private static withBonds(
    input: Frame,
    atoms: Block,
    bondI: number[],
    bondJ: number[],
  ): Frame {
    const result = new Frame();
    result.set("atoms", atoms);

    if (bondI.length > 0) {
      const bonds = new Block();
      bonds.set("atomi", toDomainUint(bondI));
      bonds.set("atomj", toDomainUint(bondJ));
      result.set("bonds", bonds);
    }

    const box = input.box;
    if (box) result.box = box;
    return result;
  }
}
