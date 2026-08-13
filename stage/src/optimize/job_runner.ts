/**
 * Worker-side optimize pipeline — pure molrs + stage geometry helpers.
 * No Babylon, no DOM, no MolvisApp.
 */

import { Block, Box, Frame, Perceive } from "@molcrafts/molvis-core/molrs";
import { ComputeBondsModifier } from "../modifiers/ComputeBondsModifier";
import { BOND_TYPE_SINGLE, setBondTopology } from "../utils/bond_order";
import { safeFree } from "../utils/yield_ui";
import { copyAtomColumns, copyBondColumns } from "./frame_columns";
import type {
  OptimizeJobPayload,
  OptimizeJobResult,
  OptimizeProgress,
} from "./protocol";
import {
  assessOptimizeSize,
  formatOptimizeError,
  isMolrsPotential,
  isWasmPanic,
  type OptimizeResult,
  type OptimizeStatus,
  packCoords,
  resolveOptimizePair,
  runDampedOptimize,
  runLbfgsOptimize,
  unpackCoords,
} from "./relax";

/** Progress → main thread (status bar + panel). */
export type JobProgressFn = (progress: OptimizeProgress) => void;
export type JobCancelFn = () => boolean;

function buildFrame(job: OptimizeJobPayload): Frame {
  const n = job.x.length;
  if (job.y.length !== n || job.z.length !== n || job.elements.length !== n) {
    throw new Error("Optimize job: x/y/z/elements length mismatch");
  }
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", job.x);
  atoms.setColF("y", job.y);
  atoms.setColF("z", job.z);
  atoms.setColStr("element", job.elements);
  frame.insertBlock("atoms", atoms);

  const nb = job.bondI.length;
  if (nb > 0) {
    if (job.bondJ.length !== nb) {
      throw new Error("Optimize job: bondI/bondJ length mismatch");
    }
    const bonds = new Block();
    const types = new Uint32Array(nb);
    const numbers = new Uint32Array(nb);
    for (let i = 0; i < nb; i++) {
      const t = job.bondType?.[i] ?? BOND_TYPE_SINGLE;
      types[i] = t;
      numbers[i] = t;
    }
    setBondTopology(bonds, job.bondI, job.bondJ, types, numbers);
    frame.insertBlock("bonds", bonds);
  }

  if (job.boxLengths && job.boxLengths.length >= 3) {
    // Real PBC cell only (main thread already filtered shouldDrawBox).
    const origin =
      job.boxOrigin && job.boxOrigin.length >= 3
        ? new Float64Array(job.boxOrigin)
        : new Float64Array([0, 0, 0]);
    // All three edges: cubing from `a` hides contacts across the short faces.
    // Triclinic is rejected upstream — the payload carries no tilts.
    const lengths = new Float64Array([
      job.boxLengths[0],
      job.boxLengths[1],
      job.boxLengths[2],
    ]);
    frame.box = Box.ortho(lengths, origin, true, true, true);
  }

  return frame;
}

function materializeOwned(source: Frame): Frame {
  const { x, y, z, elements } = copyAtomColumns(source);
  const { bondI, bondJ, bondType } = copyBondColumns(source);
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", x);
  atoms.setColF("y", y);
  atoms.setColF("z", z);
  atoms.setColStr("element", elements);
  frame.insertBlock("atoms", atoms);
  if (bondI.length > 0) {
    const bonds = new Block();
    const numbers = new Uint32Array(bondType);
    setBondTopology(bonds, bondI, bondJ, bondType, numbers);
    frame.insertBlock("bonds", bonds);
  }
  const box = source.box;
  if (box) {
    frame.box = box;
  }
  return frame;
}

/**
 * Full heavy pipeline for one optimize job (runs inside the worker).
 * `onProgress` is posted to the main thread for status bar + panel.
 */
export async function runOptimizeJob(
  job: OptimizeJobPayload,
  onProgress?: JobProgressFn,
  shouldCancel?: JobCancelFn,
): Promise<OptimizeJobResult> {
  // Legality first: `damped` only pairs with `soft`, `lbfgs` with the force
  // fields. Running L-BFGS anyway and echoing back the requested optimizer
  // reports a run the caller never asked for.
  const pair = resolveOptimizePair(job.potential, job.optimizer);

  let hydrogensAdded = 0;

  const emit = (status: OptimizeStatus) =>
    onProgress?.({
      kind: "status",
      phase: status.phase,
      message: status.message,
      progress: status.progress,
      step: status.step,
      maxSteps: status.maxSteps,
    });

  const emitStep = (info: {
    step: number;
    maxSteps: number;
    energy: number;
    maxForce: number;
    converged: boolean;
  }) =>
    onProgress?.({
      kind: "step",
      step: info.step,
      maxSteps: info.maxSteps,
      energy: info.energy,
      maxForce: info.maxForce,
      converged: info.converged,
    });

  // Progress **before** any molrs work — buildFrame/perceive can take seconds
  // on large N; the UI must not sit on "Starting…" until they finish.
  emit({
    phase: "prepare",
    message: `Preparing ${job.elements.length.toLocaleString()} atoms…`,
  });

  let frame = buildFrame(job);

  try {
    // Bonds for force fields
    if (
      job.ensureBonds &&
      isMolrsPotential(job.potential) &&
      job.bondI.length === 0
    ) {
      const nAtoms = job.elements.length;
      emit({
        phase: "prepare",
        message:
          nAtoms > 5_000
            ? `Detecting bonds on ${nAtoms.toLocaleString()} atoms…`
            : "Detecting bonds…",
      });
      let perceived: Frame | null = null;
      try {
        perceived = ComputeBondsModifier.perceiveForForceField(frame);
        const nBonds = perceived.getBlock("bonds")?.nrows() ?? 0;
        safeFree(frame);
        frame = materializeOwned(perceived);
        emit({
          phase: "prepare",
          message:
            nBonds === 0
              ? "No bonds found — continuing without bonds…"
              : `Found ${nBonds.toLocaleString()} bonds…`,
        });
      } catch (err) {
        const why = isWasmPanic(err)
          ? "internal error"
          : err instanceof Error
            ? err.message
            : String(err);
        emit({
          phase: "prepare",
          message: `Bond detection failed (${why}); continuing without bonds…`,
        });
      } finally {
        if (perceived) safeFree(perceived);
      }
    }

    if (job.addHydrogens) {
      emit({
        phase: "hydrogens",
        message: "Adding hydrogens…",
      });
      const before = copyAtomColumns(frame).n;
      const perceive = new Perceive();
      let capped: Frame;
      try {
        capped = perceive.findHydrogens(frame);
      } catch (err) {
        safeFree(frame);
        throw new Error(formatOptimizeError(err));
      } finally {
        safeFree(perceive);
      }
      const after = copyAtomColumns(capped).n;
      hydrogensAdded = Math.max(0, after - before);
      if (hydrogensAdded > 0) {
        safeFree(frame);
        frame = materializeOwned(capped);
        safeFree(capped);
        const risk = assessOptimizeSize(after, job.potential, {
          bondCount: copyBondColumns(frame).bondI.length,
        });
        if (risk.level === "hard_block" || risk.level === "soft_block") {
          safeFree(frame);
          throw new Error(
            `${risk.message} (+${hydrogensAdded} H — try turning off Add hydrogens.)`,
          );
        }
      } else {
        safeFree(capped);
      }
    }

    {
      const { n } = copyAtomColumns(frame);
      const risk = assessOptimizeSize(n, job.potential, {
        bondCount: copyBondColumns(frame).bondI.length,
      });
      if (risk.level === "hard_block" || risk.level === "soft_block") {
        safeFree(frame);
        throw new Error(risk.message);
      }
    }

    emit({
      phase: "minimize",
      message: `Minimizing (${String(job.potential).toUpperCase()})…`,
    });

    const fixed = [...job.fixedIndices];
    /** Cooperative step beat → main (status bar % + panel); coords stay here. */
    const onStep = async (step: {
      step: number;
      energy: number;
      maxForce: number;
      converged: boolean;
    }) => {
      emitStep({
        step: step.step,
        maxSteps: job.maxSteps,
        energy: step.energy,
        maxForce: step.maxForce,
        converged: step.converged,
      });
    };

    let outcome: OptimizeResult;

    if (isMolrsPotential(pair.potential)) {
      outcome = await runLbfgsOptimize(
        {
          frame,
          potential: pair.potential,
          maxSteps: job.maxSteps,
          forceTol: job.forceTol,
          fixed,
          reportEvery: job.reportEvery,
          shouldCancel,
          onStatus: emit,
        },
        onStep,
      );
    } else {
      const xyz0 = copyAtomColumns(frame);
      const b0 = copyBondColumns(frame);
      const softBonds: Array<[number, number]> = [];
      for (let i = 0; i < b0.bondI.length; i++) {
        softBonds.push([b0.bondI[i], b0.bondJ[i]]);
      }
      outcome = await runDampedOptimize(
        {
          coords: packCoords(xyz0.x, xyz0.y, xyz0.z),
          elements: xyz0.elements,
          bonds: softBonds,
          fixed,
          potential: "soft",
          maxSteps: job.maxSteps,
          forceTol: job.forceTol,
          reportEvery: job.reportEvery,
          shouldCancel,
          onStatus: emit,
        },
        onStep,
      );
    }

    const xyz = copyAtomColumns(frame);
    const bonds = copyBondColumns(frame);
    // Relaxed coordinates come from the optimizer outcome — the worker's
    // materialized frame keeps its input coordinates (never written back).
    // Both runners own their result buffer, so this is the one marshal point.
    if (outcome.coords.length !== xyz.n * 3) {
      throw new Error(
        `Optimize returned ${outcome.coords.length / 3} coords for ${xyz.n} atoms`,
      );
    }
    const outX = new Float64Array(xyz.n);
    const outY = new Float64Array(xyz.n);
    const outZ = new Float64Array(xyz.n);
    unpackCoords(outcome.coords, outX, outY, outZ);
    // Always return topology so main never depends on detached pre-transfer state.
    const result: OptimizeJobResult = {
      x: outX,
      y: outY,
      z: outZ,
      elements: xyz.elements,
      bondI: bonds.bondI,
      bondJ: bonds.bondJ,
      bondType: bonds.bondType,
      steps: outcome.steps,
      energy: outcome.energy,
      maxForce: outcome.maxForce,
      converged: outcome.converged,
      cancelled: outcome.cancelled,
      atomCount: xyz.n,
      hydrogensAdded,
      potential: job.potential,
      optimizer: job.optimizer,
    };
    return result;
  } catch (err) {
    throw new Error(formatOptimizeError(err));
  } finally {
    safeFree(frame);
  }
}
