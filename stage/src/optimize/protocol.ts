/**
 * Optimize workload job / result / progress shapes.
 *
 * Wire envelope lives in `@molcrafts/molvis-core/workload`.
 */

import type { OptimizePhase, OptimizerKind, PotentialKind } from "./relax";

/**
 * Plain working structure for cross-thread jobs (no molrs handles).
 *
 * Coordinates are one array per axis, in Å, all of length `nAtoms`; bonds are
 * parallel `bondI` / `bondJ` arrays of dense atom indices into those columns.
 * Every typed array here is transferred to the worker, so a payload is
 * single-use — see `runOptimizeOnWorker`.
 */
export interface OptimizeJobPayload {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Element symbol per atom, same order and length as `x` / `y` / `z`. */
  elements: string[];
  bondI: Uint32Array;
  bondJ: Uint32Array;
  /** Bond type code per bond; single bonds are assumed when omitted. */
  bondType?: Uint32Array;
  /**
   * Cell edge lengths `[lx, ly, lz]` (Å) for a **real** simulation cell only —
   * the main thread filters placeholder cells with `shouldDrawBox` and omits
   * this to run free-boundary (no periodic images).
   *
   * Orthorhombic only: there is no tilt field, and the main thread rejects a
   * triclinic cell before packing rather than shipping it squared.
   */
  boxLengths?: Float64Array;
  /** Cell origin `[ox, oy, oz]` (Å); `[0, 0, 0]` when omitted. */
  boxOrigin?: Float64Array;
  potential: PotentialKind;
  optimizer: OptimizerKind;
  /** Hard cap on minimizer steps. */
  maxSteps: number;
  /** Convergence threshold on the largest per-atom force (energy units / Å). */
  forceTol: number;
  /** Atom indices held in place (indices into the coordinate columns). */
  fixedIndices: Uint32Array;
  /** Perceive bonds in the worker when the payload carries none. */
  ensureBonds: boolean;
  /** Cap missing valences with explicit H before minimizing. */
  addHydrogens: boolean;
  /** Minimizer steps between step beats (also the L-BFGS chunk size). */
  reportEvery: number;
}

/**
 * What the worker sends back for one optimize job.
 *
 * Always the **final state reached**, converged or not: on cancel, `cancelled`
 * is true and `x` / `y` / `z` still hold the last coordinates, which the caller
 * publishes. `atomCount` describes the returned arrays and can exceed the input
 * atom count when hydrogens were added.
 */
export interface OptimizeJobResult {
  /** Relaxed coordinates (Å), one array per axis, length `atomCount`. */
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /**
   * Element symbols for the returned atoms. Optional on the wire, but the
   * main-thread writeback requires them and rejects a length that disagrees
   * with `atomCount`.
   */
  elements?: string[];
  /** Topology as used by the run — echoed so the caller never re-derives it. */
  bondI?: Uint32Array;
  bondJ?: Uint32Array;
  bondType?: Uint32Array;
  /** Minimizer steps actually taken. */
  steps: number;
  /**
   * Final potential energy and largest per-atom force in the potential's own
   * energy units (energy units / Å for the force) — comparable within one run,
   * not across potentials.
   */
  energy: number;
  maxForce: number;
  /** True when `maxForce` fell below the requested tolerance. */
  converged: boolean;
  /** True when the run stopped early because the host asked it to. */
  cancelled: boolean;
  /** Atoms in the returned arrays (input atoms + `hydrogensAdded`). */
  atomCount: number;
  hydrogensAdded: number;
  /**
   * The requested (potential, optimizer) pair, echoed for the caller's
   * outcome. It is also the pair that ran: the worker validates the
   * combination up front and fails the job instead of silently substituting
   * another optimizer.
   */
  potential: PotentialKind;
  optimizer: OptimizerKind;
}

/** Status-bar style beat from the worker: which phase, and a line to show. */
export interface OptimizeStatusProgress {
  kind: "status";
  phase: OptimizePhase;
  /** Short status-bar line, e.g. `Minimizing… step 40/200`. */
  message: string;
  /** 0–100 when the phase can be quantified; omitted otherwise. */
  progress?: number;
  /** Step indices when the beat came from inside the minimize loop. */
  step?: number;
  maxSteps?: number;
}

/** Minimize step beat — the numeric side of progress (energies, forces). */
export interface OptimizeStepProgress {
  kind: "step";
  step: number;
  maxSteps: number;
  energy: number;
  maxForce: number;
  converged: boolean;
}

/** Everything the worker streams while an optimize job runs. */
export type OptimizeProgress = OptimizeStatusProgress | OptimizeStepProgress;

/** Status beat as delivered to host callbacks (no `kind` discriminant). */
export type OptimizeStatusWire = {
  phase: OptimizePhase;
  message: string;
  progress?: number;
  step?: number;
  maxSteps?: number;
};

/**
 * Every buffer in a job payload, as the transfer list for `postMessage`.
 *
 * Posting with this list moves the buffers to the worker and detaches them
 * here, which is why a payload must not be reused or read after the job is
 * sent.
 */
export function optimizeJobTransferList(
  job: OptimizeJobPayload,
): Transferable[] {
  const list: Transferable[] = [
    job.x.buffer,
    job.y.buffer,
    job.z.buffer,
    job.bondI.buffer,
    job.bondJ.buffer,
    job.fixedIndices.buffer,
  ];
  if (job.bondType) list.push(job.bondType.buffer);
  if (job.boxLengths) list.push(job.boxLengths.buffer);
  if (job.boxOrigin) list.push(job.boxOrigin.buffer);
  return list;
}

/**
 * Same idea for the worker's reply: hand these buffers to the `done` message
 * so the result arrays move to the main thread instead of being copied.
 */
export function optimizeResultTransferList(
  result: OptimizeJobResult,
): Transferable[] {
  const list: Transferable[] = [
    result.x.buffer,
    result.y.buffer,
    result.z.buffer,
  ];
  if (result.bondI) list.push(result.bondI.buffer);
  if (result.bondJ) list.push(result.bondJ.buffer);
  if (result.bondType) list.push(result.bondType.buffer);
  return list;
}
