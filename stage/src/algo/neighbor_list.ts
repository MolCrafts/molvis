/**
 * Spatial neighbor search policy (compute + force-field L-BFGS).
 *
 * ## molrs vs frontend
 *
 * - Script users of `@molcrafts/molrs` pass a `NeighborList` explicitly
 *   (`new BruteForce(r).build(frame)` or `new LinkedCell(r).build(frame)`).
 * - The **frontend auto-picks** via {@link NeighborAlgorithm} +
 *   {@link SpatialNeighborQuery} / {@link LbfgsNeighborStrategy}.
 *
 * ## Algorithms (spatial, cutoff)
 *
 * - **bruteforce** — molrs `BruteForce` (O(N²) all pairs within cutoff). Fast
 *   for compact small systems.
 * - **linked_cell** — molrs `LinkedCell` (O(N·ρ·r³)). Default for large N.
 *
 * LBFGS **without** a list still builds *topology* all-pairs (no spatial
 * cutoff) and is refused for large N in molrs — frontend never omits the list.
 *
 * ## Speed crossover (WASM-measured)
 *
 * Compact blob: brute ≤500, cell ≥800 → non-PBC **650**.
 * Periodic/dense: cell earlier → **350**.
 */

import {
  BruteForce,
  type Frame,
  LBFGS,
  LinkedCell,
  type NeighborList,
  type Potentials,
} from "@molcrafts/molvis-core/molrs";

// ---------------------------------------------------------------------------
// Force-field non-electrostatic cutoffs (Å)
// ---------------------------------------------------------------------------

/**
 * Max **non-electrostatic** (VdW / dispersion) shell for LBFGS spatial NL.
 *
 * - UFF → **12.5** Å
 * - MMFF94/s → **12.0** Å
 *
 * Not RDKit `nonBondedThresh=100` (relative R* scale).
 */
export const FF_NONBONDED_CUTOFF_A = {
  uff: 12.5,
  mmff94: 12.0,
  mmff94s: 12.0,
} as const;

export type ForceFieldNeighborMethod = keyof typeof FF_NONBONDED_CUTOFF_A;

export function forceFieldNonbondedCutoff(
  method: ForceFieldNeighborMethod | string,
): number {
  if (method === "uff" || method === "mmff94" || method === "mmff94s") {
    return FF_NONBONDED_CUTOFF_A[method];
  }
  return FF_NONBONDED_CUTOFF_A.uff;
}

// ---------------------------------------------------------------------------
// Algorithm pick — wall-clock (WASM-calibrated)
// ---------------------------------------------------------------------------

export type NeighborAlgorithmKind = "bruteforce" | "linked_cell";

export interface NeighborAlgorithmContext {
  hasPeriodicBox?: boolean;
  boxVolume?: number | null;
}

/**
 * Speed model for BruteForce vs LinkedCell (materialized spatial lists).
 */
export class NeighborAlgorithm {
  /** Periodic / dense systems — LinkedCell earlier. */
  static readonly PERIODIC_CROSSOVER_ATOMS = 350;

  /** Non-periodic compact systems — brute longer (blob bench). */
  static readonly NONPERIODIC_CROSSOVER_ATOMS = 650;

  private constructor() {}

  static pick(
    atomCount: number,
    cutoff: number,
    ctx: NeighborAlgorithmContext = {},
  ): NeighborAlgorithmKind {
    const n = Math.max(0, Math.floor(atomCount));
    if (n <= 1) return "bruteforce";

    const periodic = ctx.hasPeriodicBox === true;
    const crossover = periodic
      ? NeighborAlgorithm.PERIODIC_CROSSOVER_ATOMS
      : NeighborAlgorithm.NONPERIODIC_CROSSOVER_ATOMS;

    if (n < crossover) return "bruteforce";

    const vol =
      typeof ctx.boxVolume === "number" && ctx.boxVolume > 0
        ? ctx.boxVolume
        : null;
    if (vol !== null && cutoff > 0) {
      const density = n / vol;
      const expectedNeigh =
        density * (4 / 3) * Math.PI * cutoff * cutoff * cutoff;
      if (expectedNeigh >= n * 0.5) return "bruteforce";
    }

    return "linked_cell";
  }
}

// ---------------------------------------------------------------------------
// Spatial query (BruteForce | LinkedCell → NeighborList)
// ---------------------------------------------------------------------------

export interface SpatialNeighborQueryOptions {
  storeDistSq?: boolean;
  storeDiff?: boolean;
  /**
   * When set with {@link algorithmContext}, picks BruteForce vs LinkedCell
   * automatically. When omitted, defaults to LinkedCell (safe for large N).
   */
  atomCount?: number;
  algorithmContext?: NeighborAlgorithmContext;
  /** Force algorithm (skips pick). */
  algorithm?: NeighborAlgorithmKind;
}

type SearchBackend =
  | { kind: "linked_cell"; cell: LinkedCell }
  | { kind: "bruteforce"; bf: BruteForce };

/**
 * Cutoff neighbor search: construct → {@link build} → free.
 *
 * Frontend auto-selects molrs `BruteForce` or `LinkedCell` from N / PBC /
 * density. Product is always a {@link NeighborList}.
 */
export class SpatialNeighborQuery {
  readonly cutoff: number;
  readonly algorithm: NeighborAlgorithmKind;
  private backend: SearchBackend;

  constructor(cutoff: number, options: SpatialNeighborQueryOptions = {}) {
    if (!(cutoff > 0) || !Number.isFinite(cutoff)) {
      throw new Error(
        `neighbor cutoff must be a positive finite length in Å, got ${cutoff}`,
      );
    }
    this.cutoff = cutoff;
    const n = options.atomCount;
    this.algorithm =
      options.algorithm ??
      (typeof n === "number" && Number.isFinite(n)
        ? NeighborAlgorithm.pick(n, cutoff, options.algorithmContext ?? {})
        : "linked_cell");

    const storeDistSq = options.storeDistSq ?? true;
    const storeDiff = options.storeDiff ?? false;
    this.backend =
      this.algorithm === "bruteforce"
        ? {
            kind: "bruteforce",
            bf: new BruteForce(cutoff, storeDistSq, storeDiff),
          }
        : {
            kind: "linked_cell",
            cell: new LinkedCell(cutoff, storeDistSq, storeDiff),
          };
  }

  /** Self-query unique pairs (i < j) within cutoff. Caller frees the list. */
  build(frame: Frame): NeighborList {
    return this.backend.kind === "bruteforce"
      ? this.backend.bf.build(frame)
      : this.backend.cell.build(frame);
  }

  free(): void {
    if (this.backend.kind === "bruteforce") {
      this.backend.bf.free();
    } else {
      this.backend.cell.free();
    }
  }
}

// ---------------------------------------------------------------------------
// LBFGS neighbor strategy
// ---------------------------------------------------------------------------

/**
 * How the frontend feeds nonbonded pairs into LBFGS (user never chooses).
 *
 * Always produces an explicit spatial {@link NeighborList} at the force-field
 * nonbonded cutoff — never omits the list (molrs topology-only omit path is
 * for tiny scripts only).
 */
export class LbfgsNeighborStrategy {
  readonly algorithm: NeighborAlgorithmKind;
  readonly cutoff: number;
  private readonly atomCount: number;
  private readonly ctx: NeighborAlgorithmContext;

  private constructor(
    algorithm: NeighborAlgorithmKind,
    cutoff: number,
    atomCount: number,
    ctx: NeighborAlgorithmContext,
  ) {
    this.algorithm = algorithm;
    this.cutoff = cutoff;
    this.atomCount = atomCount;
    this.ctx = ctx;
  }

  static forMethod(
    method: ForceFieldNeighborMethod | string,
    atomCount: number,
    ctx: NeighborAlgorithmContext = {},
  ): LbfgsNeighborStrategy {
    const cutoff = forceFieldNonbondedCutoff(method);
    const algorithm = NeighborAlgorithm.pick(atomCount, cutoff, ctx);
    return new LbfgsNeighborStrategy(algorithm, cutoff, atomCount, ctx);
  }

  /** Prepare pairs for current coordinates (ownership → LBFGS via prep). */
  prepare(frame: Frame): LbfgsNeighborPrep {
    const query = new SpatialNeighborQuery(this.cutoff, {
      storeDistSq: true,
      storeDiff: false,
      algorithm: this.algorithm,
      atomCount: this.atomCount,
      algorithmContext: this.ctx,
    });
    const list = query.build(frame);
    return LbfgsNeighborPrep.fromQuery(query, list);
  }
}

/**
 * One chunk's neighbor payload for LBFGS — always an explicit spatial list.
 */
export class LbfgsNeighborPrep {
  private list: NeighborList | null;
  private query: SpatialNeighborQuery | null;
  private taken = false;

  private constructor(list: NeighborList, query: SpatialNeighborQuery) {
    this.list = list;
    this.query = query;
  }

  static fromQuery(
    query: SpatialNeighborQuery,
    list: NeighborList,
  ): LbfgsNeighborPrep {
    return new LbfgsNeighborPrep(list, query);
  }

  /** Value for `new LBFGS(pots, list, …)`. Call once. */
  takeList(): NeighborList {
    if (this.taken || !this.list) {
      throw new Error("LbfgsNeighborPrep.takeList() already consumed");
    }
    this.taken = true;
    const out = this.list;
    this.list = null;
    return out;
  }

  createLbfgs(pots: Potentials, forceTol: number): LBFGS {
    return new LBFGS(pots, this.takeList(), forceTol);
  }

  free(): void {
    if (this.list) {
      try {
        this.list.free();
      } catch {
        /* poisoned */
      }
      this.list = null;
    }
    if (this.query) {
      try {
        this.query.free();
      } catch {
        /* poisoned */
      }
      this.query = null;
    }
  }
}
