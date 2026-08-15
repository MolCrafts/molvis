import { describe, expect, it } from "@rstest/core";
import { OptimizeLivePaint } from "../../src/optimize/live_paint";
import type { OptimizeCoordsProgress } from "../../src/optimize/protocol";

// Unit under test: stage/src/optimize/live_paint.ts (spec
// optimize-staging-04-live). `OptimizeLivePaint` turns one worker coords beat
// into edit-pool writes + one GPU upload, and nothing else.
//
// Every collaborator here is a STRUCTURAL fake: no Babylon mesh, no real
// SceneIndex, no MolvisApp, no worker. The production constructor must
// therefore accept narrow structural protocols (the writer surface
// `writeAtom` / `refreshBondsAround` and the tick surface `flush`), never the
// concrete `EditPoolPositions` / `ScenePaintTick` classes — passing these
// fakes must typecheck. Same rule as
// stage/tests/edit_pool_positions.test.ts, whose fake kit this mirrors.
//
// The `forbidden` recorder below is the enforcement arm of the module's
// non-call list: a live paint that reaches for `applyPipeline`,
// `registerAtomFrame`, `setFrameData` or any atom-creation call resets
// `frameOffset` / wipes the edit pool, so every id the beat just resolved
// would dangle. The fakes expose those methods precisely so a test can prove
// they were never called.

/** One `writeAtom(atomId, x, y, z)` call, recorded verbatim. */
type WriteAtomArgs = [atomId: number, x: number, y: number, z: number];

/** Calls that must never happen during a live paint, in arrival order. */
type ForbiddenLog = string[];

class FakeEditPoolPositions {
  readonly writeAtomCalls: WriteAtomArgs[] = [];
  readonly refreshBondsAroundCalls: number[][] = [];
  readonly refreshBondCalls: number[] = [];

  constructor(private readonly forbidden: ForbiddenLog) {}

  writeAtom(atomId: number, x: number, y: number, z: number): void {
    this.writeAtomCalls.push([atomId, x, y, z]);
  }

  refreshBondsAround(atomIds: Iterable<number>): void {
    this.refreshBondsAroundCalls.push(Array.from(atomIds));
  }

  refreshBond(bondId: number): void {
    this.refreshBondCalls.push(bondId);
  }

  // --- deliberate non-calls (see the header) ---
  applyPipeline(): void {
    this.forbidden.push("applyPipeline");
  }

  registerAtomFrame(): void {
    this.forbidden.push("registerAtomFrame");
  }

  setFrameData(): void {
    this.forbidden.push("setFrameData");
  }

  /** Live paint draws existing atoms only; it never materializes new ones. */
  addAtom(): void {
    this.forbidden.push("addAtom");
  }
}

class FakeScenePaintTick {
  flushCount = 0;

  constructor(private readonly forbidden: ForbiddenLog) {}

  flush(): void {
    this.flushCount += 1;
  }

  // --- deliberate non-calls (see the header) ---
  applyPipeline(): void {
    this.forbidden.push("applyPipeline");
  }

  registerAtomFrame(): void {
    this.forbidden.push("registerAtomFrame");
  }

  setFrameData(): void {
    this.forbidden.push("setFrameData");
  }
}

interface Kit {
  forbidden: ForbiddenLog;
  positions: FakeEditPoolPositions;
  tick: FakeScenePaintTick;
}

function makeKit(): Kit {
  const forbidden: ForbiddenLog = [];
  return {
    forbidden,
    positions: new FakeEditPoolPositions(forbidden),
    tick: new FakeScenePaintTick(forbidden),
  };
}

/** One worker beat. `coords` is packed xyz (Å), length 3 · `atomCount`. */
function coordsBeat(
  coords: readonly number[],
  atomCount: number,
  step = 2,
): OptimizeCoordsProgress {
  return {
    kind: "coords",
    step,
    maxSteps: 20,
    coords: new Float64Array(coords),
    atomCount,
  };
}

describe("TestOptimizeLivePaint", () => {
  describe("paint", () => {
    it("writes one atom per coordinate triple, then refreshes and flushes once", () => {
      const kit = makeKit();
      const live = new OptimizeLivePaint(kit.positions, kit.tick, 2);

      // Hard-coded golden: row i is logical atom id i (identity mapping over
      // the frame segment), 0.1 / 0.9 Å are exact float64 literals.
      live.paint(coordsBeat([0.1, 0, 0, 0.9, 0, 0], 2));

      expect(kit.positions.writeAtomCalls).toEqual([
        [0, 0.1, 0, 0],
        [1, 0.9, 0, 0],
      ]);
      expect(kit.positions.refreshBondsAroundCalls).toEqual([[0, 1]]);
      expect(kit.tick.flushCount).toBe(1);
    });

    it("ignores rows past liveAtomCount instead of creating atoms", () => {
      const kit = makeKit();
      // Hydrogens the worker capped on are in the beat but not on the canvas:
      // creating them mid-run would shift `frameOffset` and invalidate the
      // id -> row mapping every later beat depends on. Their final form lands
      // once, through the result command.
      const live = new OptimizeLivePaint(kit.positions, kit.tick, 2);

      expect(() => {
        live.paint(coordsBeat([0.1, 0, 0, 0.9, 0, 0, 1.7, 0, 0], 3));
      }).not.toThrow();

      expect(kit.positions.writeAtomCalls).toEqual([
        [0, 0.1, 0, 0],
        [1, 0.9, 0, 0],
      ]);
      expect(kit.forbidden).toEqual([]);
    });

    it("refreshes bonds and flushes once per beat, not once per atom", () => {
      const kit = makeKit();
      const live = new OptimizeLivePaint(kit.positions, kit.tick, 2);

      for (let step = 1; step <= 10; step++) {
        live.paint(coordsBeat([0.1, 0, 0, 0.9, 0, 0], 2, step));
      }

      expect(kit.positions.writeAtomCalls.length).toBe(20);
      expect(kit.positions.refreshBondsAroundCalls.length).toBe(10);
      expect(kit.tick.flushCount).toBe(10);
    });

    it("never rebuilds the scene or resets the edit pool", () => {
      const kit = makeKit();
      const live = new OptimizeLivePaint(kit.positions, kit.tick, 2);

      for (let step = 1; step <= 10; step++) {
        live.paint(coordsBeat([0.1, 0, 0, 0.9, 0, 0], 2, step));
      }

      // applyPipeline / registerAtomFrame / setFrameData / addAtom.
      expect(kit.forbidden).toEqual([]);
    });

    it("rejects a beat whose coords length disagrees with atomCount", () => {
      const kit = makeKit();
      const live = new OptimizeLivePaint(kit.positions, kit.tick, 2);

      // 7 values for 3 atoms: a truncated or mis-packed beat must be refused
      // at the main-thread boundary, never half-written into a GPU buffer.
      let message = "";
      expect(() => {
        try {
          live.paint(coordsBeat([0.1, 0, 0, 0.9, 0, 0, 1.7], 3));
        } catch (err) {
          message = err instanceof Error ? err.message : String(err);
          throw err;
        }
      }).toThrow(Error);

      // Descriptive = names the field and both counts (same shape as
      // job_runner's "Optimize returned N coords for M atoms").
      expect(message).toMatch(/coords/i);
      expect(message).toMatch(/\b7\b/);
      expect(message).toMatch(/\b3\b/);
      expect(kit.positions.writeAtomCalls).toEqual([]);
    });
  });
});
