import { describe, expect, it } from "@rstest/core";
import { runOptimizeJob } from "../../src/optimize/job_runner";
import type { OptimizeJobPayload } from "../../src/optimize/protocol";
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
