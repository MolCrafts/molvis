/**
 * The two opposite meanings of "save" around an optimize run.
 *
 * An optimize result is staged, not committed (spec
 * `optimize-staging-05-panel`), so the word "save" points in two directions
 * inside the same panel:
 *
 * - **before** the run, {@link OPTIMIZE_DIRTY_GATE_HINT} is the gate: it asks
 *   about the *user's own canvas edits*, which the optimizer would otherwise
 *   overwrite. "Unsaved" now also covers a waiting optimize result, so the gate
 *   has to name whose edits it is asking about;
 * - **after** the run, {@link OPTIMIZE_SAVE_HINT} says the optimized
 *   coordinates are staged in the workspace and only land on Ctrl+S.
 *
 * {@link OPTIMIZE_SAVE_HINT} is duplicated verbatim on the stage side, which
 * sends the same literal as its persistent `info-text-change` line
 * (`stage/src/optimize/structure.ts`, `STAGED_HINT`) so every host — page,
 * VSCode, Python — shows one standing hint. The duplication is deliberate (the
 * page must not depend on stage internals for a string) and is locked by
 * `regressions/optimize-staging-05-panel.ts`, which compares both sides;
 * editing one copy alone is exactly the drift that lock exists to catch.
 *
 * Plain strings and one pure function: no React, no stage runtime, so the
 * regression script can read this module directly.
 */

/** The verb the save hint and a converged summary both open with. */
const OPTIMIZED = "Optimized";

/**
 * Post-run: the result lives in the workspace until the user saves.
 *
 * One literal, byte for byte the stage-side `STAGED_HINT` — em dash included.
 */
export const OPTIMIZE_SAVE_HINT = "Optimized — Ctrl+S to save";

/**
 * The hint minus its opening verb, for a line that already starts with it —
 * "Optimized in 37 steps … — Ctrl+S to save" rather than saying it twice.
 */
const SAVE_HINT_TAIL = OPTIMIZE_SAVE_HINT.slice(OPTIMIZED.length);

/**
 * Pre-run gate: the user's own canvas edits, not a staged optimize result.
 *
 * Replaces the panel's older scene-wide save prompt, which became ambiguous
 * once an optimize run could itself be the thing that is unsaved. The retired
 * wording is deliberately not quoted here — the regression lock greps for it.
 */
export const OPTIMIZE_DIRTY_GATE_HINT =
  "Save or discard your canvas edits before optimizing";

/** The part of a finished run the staged summary line reads. */
export interface StagedOutcome {
  /** Minimizer steps actually taken. */
  readonly steps: number;
  /** Largest per-atom force at the last step (potential units / Å). */
  readonly maxForce: number;
  /** True when the force tolerance was met. */
  readonly converged: boolean;
  /** True when the user stopped the run — the coordinates so far are staged. */
  readonly cancelled: boolean;
  /** Hydrogens the H-cap added before minimizing; 0 when it was off. */
  readonly hydrogensAdded: number;
}

/**
 * One line for a finished run: what happened, plus the staged-until-save hint.
 *
 * Every branch carries the hint — a cancel is a stop, not an undo, and a run
 * that hits the step cap still moved the atoms, so all three leave something
 * to save.
 */
export function optimizeStagedLine(outcome: StagedOutcome): string {
  const hNote =
    outcome.hydrogensAdded > 0 ? ` · +${outcome.hydrogensAdded} H` : "";
  if (outcome.cancelled) {
    return `Optimization cancelled${hNote} · ${OPTIMIZE_SAVE_HINT}`;
  }
  if (!outcome.converged) {
    return `Optimization stopped at max steps (${outcome.steps})${hNote} · ${OPTIMIZE_SAVE_HINT}`;
  }
  return `${OPTIMIZED} in ${outcome.steps} steps · max |F| ${outcome.maxForce.toFixed(3)}${hNote}${SAVE_HINT_TAIL}`;
}
