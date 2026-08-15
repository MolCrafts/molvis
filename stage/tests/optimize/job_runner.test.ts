import { describe, expect, it } from "@rstest/core";
import { runOptimizeJob } from "../../src/optimize/job_runner";
import type {
  OptimizeCoordsProgress,
  OptimizeJobPayload,
  OptimizeProgress,
  OptimizeStepProgress,
} from "../../src/optimize/protocol";
import "../setup_wasm";

function ethanolJob(): OptimizeJobPayload {
  return {
    x: new Float64Array([0, 1.5, 2.4]),
    y: new Float64Array([0, 0, 0.9]),
    z: new Float64Array([0, 0, 0]),
    elements: ["C", "C", "O"],
    bondI: new Uint32Array([0, 1]),
    bondJ: new Uint32Array([1, 2]),
    potential: "uff",
    optimizer: "lbfgs",
    maxSteps: 40,
    forceTol: 0.5,
    fixedIndices: new Uint32Array(0),
    ensureBonds: false,
    addHydrogens: false,
    reportEvery: 5,
  };
}

/**
 * Two methyl fragments, no bonds supplied, so the runner perceives topology
 * (`ensureBonds`). C0 and C4 sit 4.5 Å apart along y in the primary image;
 * across the y face of a 6 Å edge the minimum image is 1.5 Å — a C–C bond.
 * Everything is fixed and `forceTol` is wide open, so the run reports the
 * perceived topology without moving an atom.
 */
function methylPairAcrossYFace(): OptimizeJobPayload {
  return {
    x: new Float64Array([3, 3, 3.94, 2.06, 3, 3, 3.94, 2.06]),
    y: new Float64Array([0.5, 1.59, 1.04, 1.04, 5.0, 3.91, 4.46, 4.46]),
    z: new Float64Array([3, 3, 3, 3, 3, 3, 3, 3]),
    elements: ["C", "H", "H", "H", "C", "H", "H", "H"],
    bondI: new Uint32Array(0),
    bondJ: new Uint32Array(0),
    // Orthorhombic: long x, short y/z. Cubing this from lengths[0] hides the
    // y-face contact behind a 12 Å edge.
    boxLengths: new Float64Array([12, 6, 6]),
    potential: "uff",
    optimizer: "lbfgs",
    maxSteps: 1,
    forceTol: 1e6,
    fixedIndices: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7]),
    ensureBonds: true,
    addHydrogens: false,
    reportEvery: 1,
  };
}

/**
 * Same three atoms on the soft-spring / damped path — the second kernel
 * (`runDampedOptimize`), which never touches a molrs force field.
 *
 * `reportEvery = 2` with `maxSteps = 4` puts beats on steps 2 and 4, and
 * `forceTol = 1e-9` keeps the run from converging early, so both beats come
 * out of the reporting branch rather than the convergence one. The damped
 * kernel mutates ONE coordinate buffer in place across all four steps, which
 * is what makes it the path where a pass-through (non-copy) beat is visible.
 */
function softDampedJob(): OptimizeJobPayload {
  return {
    x: new Float64Array([0, 1.0, 2.0]),
    y: new Float64Array([0, 0, 0.6]),
    z: new Float64Array([0, 0, 0]),
    elements: ["C", "C", "O"],
    bondI: new Uint32Array([0, 1]),
    bondJ: new Uint32Array([1, 2]),
    potential: "soft",
    optimizer: "damped",
    maxSteps: 4,
    forceTol: 1e-9,
    fixedIndices: new Uint32Array(0),
    ensureBonds: false,
    addHydrogens: false,
    reportEvery: 2,
  };
}

/** One run's beats, split by wire variant. */
interface BeatLog {
  steps: OptimizeStepProgress[];
  coords: OptimizeCoordsProgress[];
  /** `Array.from(beat.coords)` taken the moment the beat arrived. */
  coordsAtArrival: number[][];
}

/**
 * Record every progress beat of one run, snapshotting each coords beat's
 * values **at arrival** so a later read can prove they did not drift.
 */
function beatLog(): {
  log: BeatLog;
  onProgress: (p: OptimizeProgress) => void;
} {
  const log: BeatLog = { steps: [], coords: [], coordsAtArrival: [] };
  return {
    log,
    onProgress: (p) => {
      if (p.kind === "step") log.steps.push(p);
      if (p.kind === "coords") {
        log.coords.push(p);
        log.coordsAtArrival.push(Array.from(p.coords));
      }
    },
  };
}

/** Perceived bonds as sorted `i-j` keys (pair order is not part of the API). */
function bondKeys(bondI?: Uint32Array, bondJ?: Uint32Array): string[] {
  const i = bondI ?? new Uint32Array(0);
  const j = bondJ ?? new Uint32Array(0);
  const keys: string[] = [];
  for (let b = 0; b < i.length; b++) {
    const lo = Math.min(i[b], j[b]);
    const hi = Math.max(i[b], j[b]);
    keys.push(`${lo}-${hi}`);
  }
  return keys.sort();
}

describe("runOptimizeJob (worker compute body)", () => {
  it("UFF relaxes ethanol off the UI thread body", async () => {
    const statuses: string[] = [];
    const r = await runOptimizeJob(ethanolJob(), (p) => {
      if (p.kind === "status") statuses.push(p.message);
    });
    expect(r.cancelled).toBe(false);
    expect(Number.isFinite(r.energy)).toBe(true);
    expect(r.atomCount).toBe(3);
    expect(r.elements?.length).toBe(3);
    expect(statuses.length).toBeGreaterThan(0);
  }, 30_000);

  it("builds an orthorhombic cell instead of cubing the first edge", async () => {
    const r = await runOptimizeJob(methylPairAcrossYFace());
    // Hard-coded golden: molrs covalent perception under the [12,6,6] cell.
    // 6 C–H bonds plus the C0–C4 contact through the 6 Å y face.
    expect(bondKeys(r.bondI, r.bondJ)).toEqual([
      "0-1",
      "0-2",
      "0-3",
      "0-4",
      "4-5",
      "4-6",
      "4-7",
    ]);
  }, 30_000);

  // --- coords beats (spec optimize-staging-04-live) ------------------------
  // The kernels already hold live coordinates every `reportEvery` steps
  // (`OptimizeStep.coords`); `onStep` used to drop them ("coords stay here"),
  // which is why a long run showed a frozen canvas. These cases pin that every
  // step beat is now accompanied by a `kind: "coords"` beat carrying an OWNED
  // COPY of those coordinates.

  it("emits one coords beat per step beat on the damped path", async () => {
    const { log, onProgress } = beatLog();

    const r = await runOptimizeJob(softDampedJob(), onProgress);

    // Hard-coded golden: reportEvery 2 over maxSteps 4 reports on steps 2 and 4.
    expect(log.steps.map((s) => s.step)).toEqual([2, 4]);
    expect(log.coords.length).toBe(log.steps.length);
    expect(log.coords.map((c) => c.step)).toEqual([2, 4]);
    expect(log.coords.map((c) => c.maxSteps)).toEqual([4, 4]);
    // atomCount describes the frame the kernel is minimizing (3 atoms in, no
    // hydrogens added), and coords is packed xyz of exactly that many atoms.
    expect(log.coords.map((c) => c.atomCount)).toEqual([3, 3]);
    expect(log.coords.map((c) => c.coords.length)).toEqual([9, 9]);
    expect(r.atomCount).toBe(3);
  }, 30_000);

  it("hands each coords beat an owned copy, not the kernel's live buffer", async () => {
    const { log, onProgress } = beatLog();

    // The damped kernel mutates its one packed buffer in place between step 2
    // and step 4 — that in-run mutation IS "the kernel buffer changed after a
    // beat was emitted" (the same thing the workload heartbeat does when it
    // re-posts the last progress verbatim, later).
    await runOptimizeJob(softDampedJob(), onProgress);

    expect(log.coords.length).toBe(2);
    // Guard against a vacuous pass: the kernel really moved the atoms between
    // the two beats (~0.012 Å, far above the 1e-8 position tolerance).
    expect(log.coordsAtArrival[0]).not.toEqual(log.coordsAtArrival[1]);
    // A pass-through would hand the same mutated Float64Array to every beat.
    expect(log.coords[0].coords).not.toBe(log.coords[1].coords);
    // A copy is bit-identical, so exact equality is the right assertion here:
    // read after the run, each beat still shows its emit-time values.
    expect(Array.from(log.coords[0].coords)).toEqual(log.coordsAtArrival[0]);
    expect(Array.from(log.coords[1].coords)).toEqual(log.coordsAtArrival[1]);
  }, 30_000);

  it("reports coordinates on the L-BFGS / molrs-potential path", async () => {
    const { log, onProgress } = beatLog();

    await runOptimizeJob(ethanolJob(), onProgress);

    expect(log.coords.length).toBeGreaterThan(0);
    const first = log.coords[0];
    expect(first.atomCount).toBe(3);
    expect(first.coords.length).toBe(9);
    expect(first.maxSteps).toBe(40);
    expect(first.step).toBeGreaterThan(0);
    expect(Array.from(first.coords).every((v) => Number.isFinite(v))).toBe(
      true,
    );
  }, 30_000);

  it("reports coordinates on the damped / soft path", async () => {
    const { log, onProgress } = beatLog();

    await runOptimizeJob(softDampedJob(), onProgress);

    expect(log.coords.length).toBeGreaterThan(0);
    const first = log.coords[0];
    expect(first.atomCount).toBe(3);
    expect(first.coords.length).toBe(9);
    expect(first.maxSteps).toBe(4);
    expect(first.step).toBeGreaterThan(0);
    expect(Array.from(first.coords).every((v) => Number.isFinite(v))).toBe(
      true,
    );
  }, 30_000);

  it("rejects a potential/optimizer pair it cannot run", async () => {
    // `damped` only pairs with `soft`; UFF silently ran L-BFGS and echoed
    // back `optimizer: "damped"` in the result.
    await expect(
      runOptimizeJob({
        ...ethanolJob(),
        potential: "uff",
        optimizer: "damped",
      }),
    ).rejects.toThrow();
  }, 30_000);
});
