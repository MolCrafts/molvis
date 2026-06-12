import { Block, Frame, LinkedCell } from "@molcrafts/molrs";
import { viewAtomCoords } from "../io/atom_coords";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { PeriodicTable } from "../system/elements";
import { DType } from "../utils/dtype";
import { logger } from "../utils/logger";

/** How a pair of atoms is judged to be bonded. */
export type BondCriterion = "distance" | "covalent";

/** Fallback covalent radius (carbon, A) when an element is unknown. */
const FALLBACK_RADIUS = 0.77;

/**
 * ComputeBondsModifier — rebuilds the `bonds` block by perceiving bonds
 * from atom geometry. Two criteria:
 *
 * - `"distance"`: two atoms bond when their separation `d` satisfies
 *   `minDistance <= d <= cutoff`.
 * - `"covalent"`: two atoms bond when `d <= (r_i + r_j) * tolerance`,
 *   where `r` is the element covalent radius from {@link PeriodicTable}.
 *   `tolerance` is user-adjustable (typically ~1.15–1.3).
 *
 * Pure data transform (TransformsData): returns a new Frame carrying the
 * original atoms/box plus a freshly computed `bonds` block. Any existing
 * bonds are replaced — perception is authoritative. Place it before
 * `DrawBondModifier` so the renderer draws the perceived topology.
 *
 * Neighbor search uses molrs `LinkedCell` (O(N) cell list, PBC-aware via
 * `frame.simbox`); we post-filter returned pairs by the per-pair threshold.
 */
export class ComputeBondsModifier extends BaseModifier {
  private _criterion: BondCriterion = "covalent";
  private _cutoff = 1.8;
  private _tolerance = 1.2;
  private _minDistance = 0.4;

  constructor(id = "compute-bonds-default") {
    super(id, "Compute Bonds", new Set([ModifierCapability.TransformsData]));
  }

  /** Bonding criterion: `"distance"` or `"covalent"`. */
  get criterion(): BondCriterion {
    return this._criterion;
  }
  set criterion(v: BondCriterion) {
    this._criterion = v;
  }

  /** Fixed distance cutoff in A (distance criterion). */
  get cutoff(): number {
    return this._cutoff;
  }
  set cutoff(v: number) {
    this._cutoff = v;
  }

  /** Scaling factor applied to the summed covalent radii (covalent criterion). */
  get tolerance(): number {
    return this._tolerance;
  }
  set tolerance(v: number) {
    this._tolerance = v;
  }

  /** Lower distance bound in A; pairs closer than this are rejected. */
  get minDistance(): number {
    return this._minDistance;
  }
  set minDistance(v: number) {
    this._minDistance = v;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this._criterion}:${this._cutoff}:${this._tolerance}:${this._minDistance}`;
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    const atoms = input.getBlock("atoms");
    if (!atoms) {
      logger.warn("ComputeBonds: no atoms block, skipping");
      return input;
    }

    const atomCount = atoms.nrows();
    if (atomCount < 2) return input;

    // Resolve coordinates (accepts x/y/z or LAMMPS-unwrapped xu/yu/zu).
    const coords = viewAtomCoords(atoms);
    if (!coords) {
      logger.warn("ComputeBonds: missing x/y/z or xu/yu/zu columns, skipping");
      return input;
    }

    // Element symbols are required only for the covalent criterion.
    const elements =
      atoms.dtype("element") === DType.String
        ? (atoms.copyColStr("element") as string[])
        : undefined;
    if (this._criterion === "covalent" && !elements) {
      logger.warn(
        "ComputeBonds: covalent criterion needs an 'element' column, skipping",
      );
      return input;
    }

    const radii = elements
      ? elements.map((el) => PeriodicTable[el]?.radius ?? FALLBACK_RADIUS)
      : undefined;

    const searchCutoff = this.resolveSearchCutoff(radii);
    if (searchCutoff <= 0) return input;

    const minSq = this._minDistance * this._minDistance;
    const tol = this._tolerance;
    const fixedSq = this._cutoff * this._cutoff;
    const covalent = this._criterion === "covalent";

    const bondI: number[] = [];
    const bondJ: number[] = [];

    // LinkedCell reads the literal x/y/z columns. For unwrapped xu/yu/zu
    // frames we alias the coordinates into a throwaway search frame; pair
    // indices it returns line up with the original atom order. Unwrapped
    // coordinates use free boundaries (no simbox) — wrapping them across
    // PBC images would invent spurious bonds.
    const searchFrame = coords.columns.x === "x" ? input : new Frame();
    const tempFrame = searchFrame === input ? undefined : searchFrame;
    if (tempFrame) {
      const tempAtoms = new Block();
      tempAtoms.setColF("x", coords.x.slice());
      tempAtoms.setColF("y", coords.y.slice());
      tempAtoms.setColF("z", coords.z.slice());
      tempFrame.insertBlock("atoms", tempAtoms);
    }

    const cell = new LinkedCell(searchCutoff);
    let nlist: ReturnType<LinkedCell["build"]> | undefined;
    try {
      nlist = cell.build(searchFrame);
      const iIdx = nlist.queryPointIndices();
      const jIdx = nlist.pointIndices();
      const dSq = nlist.distSq();
      const pairs = nlist.numPairs;

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
      nlist?.free();
      cell.free();
      tempFrame?.free();
    }

    return this.buildResult(input, atoms, bondI, bondJ);
  }

  /**
   * Whether `frame` carries the string `element` column the covalent
   * criterion needs. The UI uses this to disable covalent mode (with an
   * explanatory tooltip) on frames that only have numeric atom types.
   */
  static hasElementData(frame: Frame): boolean {
    const atoms = frame.getBlock("atoms");
    return atoms?.dtype("element") === DType.String;
  }

  /**
   * Cell-list search radius. Distance criterion uses the fixed cutoff;
   * covalent uses `2 * max(radius) * tolerance` over the elements present,
   * the largest possible per-pair threshold.
   */
  private resolveSearchCutoff(radii: number[] | undefined): number {
    if (this._criterion === "distance") return this._cutoff;
    let maxRadius = 0;
    if (radii) {
      for (const r of radii) if (r > maxRadius) maxRadius = r;
    }
    return 2 * maxRadius * this._tolerance;
  }

  /**
   * Assemble the output frame: original atoms + box, with the perceived
   * `bonds` block. When no bonds are found the block is omitted so the
   * renderer draws none.
   */
  private buildResult(
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

    const box = input.simbox;
    if (box) result.simbox = box;

    return result;
  }
}
