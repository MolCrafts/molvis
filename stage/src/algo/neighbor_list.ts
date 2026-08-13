/**
 * Spatial neighbor search policy (compute + force-field L-BFGS).
 *
 * ## molrs vs frontend
 *
 * - Script users of `@molcrafts/molrs` drive the engine directly
 *   (`new NeighborList(r)` / `NeighborList.bruteForce(r)` → `build(frame)` →
 *   `neighbors(...)` → {@link Neighbors} table).
 * - The **frontend auto-picks** the backend via {@link NeighborAlgorithm} +
 *   {@link SpatialNeighborQuery} / {@link LbfgsNeighborStrategy}.
 *
 * ## Backends (spatial, cutoff)
 *
 * - **bruteforce** — `NeighborList.bruteForce` (O(N²) all pairs within
 *   cutoff). Fast for compact small systems.
 * - **linked_cell** — `new NeighborList` (O(N·ρ·r³) cell list). Default for
 *   large N.
 *
 * LBFGS **without** a table still builds *topology* all-pairs (no spatial
 * cutoff) and is refused for large N in molrs — frontend never omits it.
 *
 * ## Speed crossover (WASM-measured)
 *
 * Compact blob: brute ≤500, cell ≥800 → non-PBC **650**.
 * Periodic/dense: cell earlier → **350**.
 */

import {
  Block,
  Frame,
  LBFGS,
  NeighborList,
  type Neighbors,
  type Potentials,
} from "@molcrafts/molvis-core/molrs";
import { shouldDrawBox } from "../io/box_presence";
import { safeFree } from "../utils/yield_ui";

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
// Spatial query (NeighborList engine → Neighbors table)
// ---------------------------------------------------------------------------

export interface SpatialNeighborQueryOptions {
  /** Keep the squared-distance column (molrs `distSq`). Default `true`. */
  distSq?: boolean;
  /**
   * Keep MIC displacement vectors per pair (molrs `disp`, `r_j - r_i`).
   *
   * Default `false` (lean tables for RDF / cluster / selection).
   * **Must be `true`** for Steinhardt / SolidLiquid / Hexatic — those read
   * the displacement column for θ/φ.
   */
  disp?: boolean;
  /**
   * When set with {@link algorithmContext}, picks the backend automatically.
   * When omitted, defaults to the cell list (safe for large N).
   */
  atomCount?: number;
  algorithmContext?: NeighborAlgorithmContext;
  /** Force algorithm (skips pick). */
  algorithm?: NeighborAlgorithmKind;
}

/**
 * Cutoff neighbor search: construct → {@link build} → free.
 *
 * Frontend auto-selects the molrs `NeighborList` backend (brute vs cell)
 * from N / PBC / density. Product is always a materialized {@link Neighbors}
 * table.
 */
export class SpatialNeighborQuery {
  readonly cutoff: number;
  readonly algorithm: NeighborAlgorithmKind;
  private readonly engine: NeighborList;
  private readonly storage: { distSq: boolean; disp: boolean };

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

    this.engine =
      this.algorithm === "bruteforce"
        ? NeighborList.bruteForce(cutoff)
        : new NeighborList(cutoff);
    this.storage = {
      distSq: options.distSq ?? true,
      disp: options.disp ?? false,
    };
  }

  /**
   * Self-query unique pairs (i < j) within cutoff — **nonbonded** geometry
   * only (not chemical topology). Caller frees the list.
   *
   * PBC policy matches product box rules ({@link shouldDrawBox}):
   * - real cell → search on `frame` (molrs may use `frame.box` for MI/PBC)
   * - no cell / non-PBC cell → free-boundary search (atom xyz only)
   *
   * molrs always reads `frame.box` when present; if the product treats a cell
   * as non-PBC we must not hand that cell into the neighbor builder.
   */
  build(frame: Frame): Neighbors {
    const boxCopy = frame.box;
    if (!boxCopy) {
      // molrs derives a padded free-boundary box itself — no simbox needed.
      return this.buildOn(frame);
    }
    let usePbc = false;
    try {
      usePbc = shouldDrawBox(boxCopy);
    } finally {
      // Getter returns an owned copy — always free it.
      safeFree(boxCopy);
    }

    if (usePbc) {
      return this.buildOn(frame);
    }

    // Non-PBC cell on frame: search free-boundary so molrs PBC does not
    // disagree with shouldDrawBox.
    const freeFrame = freeBoundaryAtomFrame(frame);
    try {
      return this.buildOn(freeFrame);
    } finally {
      safeFree(freeFrame);
    }
  }

  private buildOn(frame: Frame): Neighbors {
    this.engine.build(frame);
    return this.engine.neighbors(this.storage);
  }

  free(): void {
    this.engine.free();
  }
}

/**
 * Atom xyz only (no box) for free-boundary **neighbor** search.
 * Does not copy bonds/topology — neighbors are nonbonded pairs, not bonds.
 * Caller owns and must free the returned frame.
 */
function freeBoundaryAtomFrame(source: Frame): Frame {
  const atoms = source.getBlock("atoms");
  if (!atoms) {
    throw new Error("SpatialNeighborQuery: frame has no atoms block");
  }
  const x = atoms.copyColF("x");
  const y = atoms.copyColF("y");
  const z = atoms.copyColF("z");
  if (!x || !y || !z) {
    throw new Error("SpatialNeighborQuery: atoms missing x/y/z columns");
  }
  const out = new Frame();
  const block = new Block();
  block.setColF("x", x);
  block.setColF("y", y);
  block.setColF("z", z);
  out.insertBlock("atoms", block);
  return out;
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
      distSq: true,
      disp: false,
      algorithm: this.algorithm,
      atomCount: this.atomCount,
      algorithmContext: this.ctx,
    });
    const list = query.build(frame);
    return LbfgsNeighborPrep.fromQuery(query, list);
  }
}

/**
 * One chunk's neighbor payload for LBFGS — always an explicit spatial table.
 */
export class LbfgsNeighborPrep {
  private list: Neighbors | null;
  private query: SpatialNeighborQuery | null;
  private taken = false;

  private constructor(list: Neighbors, query: SpatialNeighborQuery) {
    this.list = list;
    this.query = query;
  }

  static fromQuery(
    query: SpatialNeighborQuery,
    list: Neighbors,
  ): LbfgsNeighborPrep {
    return new LbfgsNeighborPrep(list, query);
  }

  /** Value for `new LBFGS(pots, neighbors, …)`. Call once. */
  takeList(): Neighbors {
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
