import { describe, expect, it } from "@rstest/core";
import {
  OPTIMIZE_DIRTY_GATE_HINT,
  OPTIMIZE_SAVE_HINT,
  optimizeStagedLine,
} from "../../src/lib/optimize-staging-copy";

/**
 * Copy for the two opposite meanings of "save" around an optimize run
 * (spec `optimize-staging-05-panel`):
 *
 * - **before** the run, "save" is about the user's own canvas edits, which the
 *   optimizer would otherwise discard — {@link OPTIMIZE_DIRTY_GATE_HINT};
 * - **after** the run, "save" is about the staged optimize result that only
 *   lands on Ctrl+S — {@link OPTIMIZE_SAVE_HINT}, the same literal the
 *   stage side sends as its persistent `info-text-change` line.
 *
 * Pure strings, no DOM: the panel test covers where they are rendered.
 */

/** Shape the panel hands over — kept in step with the production signature. */
type StagedOutcome = Parameters<typeof optimizeStagedLine>[0];

const CONVERGED: StagedOutcome = {
  steps: 37,
  maxForce: 0.041,
  converged: true,
  cancelled: false,
  hydrogensAdded: 0,
};

const MAX_STEPS: StagedOutcome = {
  steps: 200,
  maxForce: 0.62,
  converged: false,
  cancelled: false,
  hydrogensAdded: 0,
};

const CANCELLED: StagedOutcome = {
  steps: 12,
  maxForce: 0.94,
  converged: false,
  cancelled: true,
  hydrogensAdded: 0,
};

const WITH_HYDROGENS: StagedOutcome = {
  steps: 37,
  maxForce: 0.041,
  converged: true,
  cancelled: false,
  hydrogensAdded: 4,
};

describe("TestOptimizeStagingCopy", () => {
  it("reads a converged run as one staged line", () => {
    // Hard-coded golden: step count, `maxForce.toFixed(3)`, the middot
    // separator and the em-dash save hint, verbatim.
    expect(optimizeStagedLine(CONVERGED)).toBe(
      "Optimized in 37 steps · max |F| 0.041 — Ctrl+S to save",
    );
  });

  it("says a run that hit the step cap is staged as well", () => {
    const line = optimizeStagedLine(MAX_STEPS);
    expect(line).toMatch(/max steps/i);
    expect(line).toContain("(200)");
    expect(line.endsWith(OPTIMIZE_SAVE_HINT)).toBe(true);
  });

  it("says a cancelled run is staged as well", () => {
    // A cancel is a stop, not an undo: the coordinates reached so far are
    // staged, so this branch carries the same save hint.
    const line = optimizeStagedLine(CANCELLED);
    expect(line).toMatch(/cancelled/i);
    expect(line.endsWith(OPTIMIZE_SAVE_HINT)).toBe(true);
  });

  it("counts capped hydrogens in the staged line", () => {
    // Whole-string golden: it pins the `+N H` suffix *and* the converged
    // fold in one assertion. A converged line already opens with "Optimized",
    // so it carries only the hint's tail — `endsWith(OPTIMIZE_SAVE_HINT)`
    // would demand the verb twice (ac-002, amended).
    expect(optimizeStagedLine(WITH_HYDROGENS)).toBe(
      "Optimized in 37 steps · max |F| 0.041 · +4 H — Ctrl+S to save",
    );
  });

  it("keeps the pre-run gate and the post-run hint apart", () => {
    expect(OPTIMIZE_SAVE_HINT).toBe("Optimized — Ctrl+S to save");
    expect(OPTIMIZE_DIRTY_GATE_HINT).toBe(
      "Save or discard your canvas edits before optimizing",
    );
    expect(OPTIMIZE_DIRTY_GATE_HINT).not.toBe(OPTIMIZE_SAVE_HINT);
    // The stage side sends this exact line as `info-text-change`; an ASCII
    // hyphen or an en dash here would break that cross-package match.
    expect(OPTIMIZE_SAVE_HINT.includes("—")).toBe(true); // em dash
    expect(OPTIMIZE_SAVE_HINT.includes("-")).toBe(false); // ASCII hyphen
    expect(OPTIMIZE_SAVE_HINT.includes("–")).toBe(false); // en dash
  });
});
