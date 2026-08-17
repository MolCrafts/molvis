import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import { PeriodicTable } from "../system/elements";
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
    const atoms = frame.getBlock("atoms");
    return atoms?.dtype("element") === DType.String;
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
    const atoms = input.getBlock("atoms");
    if (!atoms || atoms.nrows() < 2) return input;

    const coords = viewAtomCoords(atoms);
    if (!coords) return input;

    const elements =
      atoms.dtype("element") === DType.String
        ? (atoms.copyColStr("element") as string[])
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

    // LinkedCell reads literal x/y/z. Unwrapped xu/yu/zu frames get a
    // throwaway search frame so pair indices still match atom order.
    // Unwrapped coords use free boundaries — wrapping invents bonds.
    const searchFrame = coords.columns.x === "x" ? input : new Frame();
    const tempFrame = searchFrame === input ? undefined : searchFrame;
    if (tempFrame) {
      const tempAtoms = new Block();
      tempAtoms.setColF("x", coords.x.slice());
      tempAtoms.setColF("y", coords.y.slice());
      tempAtoms.setColF("z", coords.z.slice());
      tempFrame.insertBlock("atoms", tempAtoms);
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
      const pairs = neighbors.numPairs;

      for (let p = 0; p < pairs; p++) {
        const d2 = dSq[p];
        if (d2 < minSq) continue;

        let thresholdSq: number;
        if (covalent && radii) {
          const sum = (radii[iIdx[p]] + radii[jIdx[p]]) * tol;
          thresholdSq = sum * sum;
        } else {
          thresholdSq = fixedSq;
        }

        if (d2 <= thresholdSq) {
          bondI.push(iIdx[p]);
          bondJ.push(jIdx[p]);
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
    result.insertBlock("atoms", atoms);

    if (bondI.length > 0) {
      const bonds = new Block();
      bonds.setColU32("atomi", Uint32Array.from(bondI));
      bonds.setColU32("atomj", Uint32Array.from(bondJ));
      result.insertBlock("bonds", bonds);
    }

    const box = input.box;
    if (box) result.box = box;
    return result;
  }
}
