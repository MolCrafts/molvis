import type { Frame } from "@molcrafts/molvis-core/molrs";
import { type BondCriterion, PerceiveBonds } from "../algo/perceive_bonds";
import { viewAtomCoords } from "../io/atom_coords";
import { BaseModifier, ModifierCapability } from "../pipeline/modifier";
import type { PipelineContext } from "../pipeline/types";
import { DType } from "../utils/dtype";
import { logger } from "../utils/logger";

export type { BondCriterion } from "../algo/perceive_bonds";

/**
 * Pipeline wrapper around {@link PerceiveBonds}.
 *
 * - `"distance"`: two atoms bond when `minDistance <= d <= cutoff`
 * - `"covalent"`: `d <= (r_i + r_j) * tolerance`
 *
 * Pure data transform: new Frame with a rebuilt `bonds` block. Place it
 * before `DrawBondModifier` so the renderer draws the perceived topology.
 */
export class ComputeBondsModifier extends BaseModifier {
  private readonly job = new PerceiveBonds();

  constructor(id = "compute-bonds-default") {
    super(id, "Create bonds", new Set([ModifierCapability.TransformsData]));
  }

  get criterion(): BondCriterion {
    return this.job.criterion;
  }
  set criterion(v: BondCriterion) {
    this.job.criterion = v;
  }

  get cutoff(): number {
    return this.job.cutoff;
  }
  set cutoff(v: number) {
    this.job.cutoff = v;
  }

  get tolerance(): number {
    return this.job.tolerance;
  }
  set tolerance(v: number) {
    this.job.tolerance = v;
  }

  get minDistance(): number {
    return this.job.minDistance;
  }
  set minDistance(v: number) {
    this.job.minDistance = v;
  }

  getCacheKey(): string {
    return `${super.getCacheKey()}:${this.job.criterion}:${this.job.cutoff}:${this.job.tolerance}:${this.job.minDistance}`;
  }

  apply(input: Frame, _context: PipelineContext): Frame {
    const atoms = input.getBlock("atoms");
    if (!atoms) {
      logger.warn("ComputeBonds: no atoms block, skipping");
      return input;
    }
    if (!viewAtomCoords(atoms)) {
      logger.warn("ComputeBonds: missing x/y/z or xu/yu/zu columns, skipping");
      return input;
    }
    if (
      this.job.criterion === "covalent" &&
      atoms.dtype("element") !== DType.String
    ) {
      logger.warn(
        "ComputeBonds: covalent criterion needs an 'element' column, skipping",
      );
      return input;
    }
    return this.job.apply(input);
  }

  /** Whether `frame` has the string `element` column covalent mode needs. */
  static hasElementData(frame: Frame): boolean {
    return PerceiveBonds.hasElementData(frame);
  }

  /**
   * Standalone force-field preflight (no pipeline). Prefer
   * {@link PerceiveBonds.forForceField} from worker code so the compute
   * graph does not import this modifier.
   */
  static perceiveForForceField(input: Frame): Frame {
    return PerceiveBonds.forForceField(input);
  }
}
