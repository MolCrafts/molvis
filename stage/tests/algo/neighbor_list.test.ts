import { Block, Frame, UFFTypifier } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  FF_NONBONDED_CUTOFF_A,
  forceFieldNonbondedCutoff,
  LbfgsNeighborStrategy,
  NeighborAlgorithm,
  SpatialNeighborQuery,
} from "../../src/algo/neighbor_list";

describe("NeighborAlgorithm (speed pick)", () => {
  it("prefers bruteforce for small N", () => {
    expect(NeighborAlgorithm.pick(50, 12, { hasPeriodicBox: true })).toBe(
      "bruteforce",
    );
    expect(NeighborAlgorithm.pick(50, 12, { hasPeriodicBox: false })).toBe(
      "bruteforce",
    );
  });

  it("prefers LinkedCell past the periodic crossover (WASM-calibrated)", () => {
    expect(
      NeighborAlgorithm.pick(NeighborAlgorithm.PERIODIC_CROSSOVER_ATOMS, 12, {
        hasPeriodicBox: true,
      }),
    ).toBe("linked_cell");
    expect(NeighborAlgorithm.pick(500, 12.5, { hasPeriodicBox: true })).toBe(
      "linked_cell",
    );
  });

  it("raises crossover when non-periodic (blob: brute to ~650)", () => {
    expect(NeighborAlgorithm.pick(500, 12, { hasPeriodicBox: false })).toBe(
      "bruteforce",
    );
    expect(
      NeighborAlgorithm.pick(
        NeighborAlgorithm.NONPERIODIC_CROSSOVER_ATOMS,
        12,
        {
          hasPeriodicBox: false,
        },
      ),
    ).toBe("linked_cell");
  });

  it("falls back to bruteforce when cutoff covers most of the box", () => {
    expect(
      NeighborAlgorithm.pick(2_000, 50, {
        hasPeriodicBox: true,
        boxVolume: 20 * 20 * 20,
      }),
    ).toBe("bruteforce");
  });
});

describe("force-field cutoffs", () => {
  it("are absolute Å non-electrostatic shells", () => {
    expect(forceFieldNonbondedCutoff("uff")).toBe(FF_NONBONDED_CUTOFF_A.uff);
    expect(forceFieldNonbondedCutoff("mmff94")).toBe(
      FF_NONBONDED_CUTOFF_A.mmff94,
    );
    expect(forceFieldNonbondedCutoff("uff")).toBeLessThan(30);
    expect(forceFieldNonbondedCutoff("uff")).toBeGreaterThan(8);
  });
});

describe("SpatialNeighborQuery", () => {
  it("auto-picks BruteForce for small N", () => {
    const q = new SpatialNeighborQuery(3.0, {
      atomCount: 40,
      algorithmContext: { hasPeriodicBox: false },
    });
    expect(q.algorithm).toBe("bruteforce");
    q.free();
  });

  it("auto-picks LinkedCell for large N", () => {
    const q = new SpatialNeighborQuery(3.0, {
      atomCount: 5_000,
      algorithmContext: { hasPeriodicBox: true },
    });
    expect(q.algorithm).toBe("linked_cell");
    q.free();
  });

  it("construct → build → free (BruteForce path)", () => {
    const frame = new Frame();
    const ab = new Block();
    ab.setColF("x", new Float64Array([0, 1, 10]));
    ab.setColF("y", new Float64Array([0, 0, 0]));
    ab.setColF("z", new Float64Array([0, 0, 0]));
    ab.setColStr("element", ["C", "C", "C"]);
    frame.insertBlock("atoms", ab);
    const query = new SpatialNeighborQuery(2.0, {
      atomCount: 3,
      algorithmContext: { hasPeriodicBox: false },
    });
    try {
      expect(query.algorithm).toBe("bruteforce");
      const list = query.build(frame);
      try {
        expect(list.numPairs).toBeGreaterThanOrEqual(1);
      } finally {
        list.free();
      }
    } finally {
      query.free();
      frame.free();
    }
  });

  it("rejects non-positive cutoff", () => {
    expect(() => new SpatialNeighborQuery(0)).toThrow(/cutoff/i);
  });
});

describe("LbfgsNeighborStrategy", () => {
  it("small molecule uses BruteForce spatial list", () => {
    const s = LbfgsNeighborStrategy.forMethod("uff", 30, {
      hasPeriodicBox: false,
    });
    expect(s.algorithm).toBe("bruteforce");
    expect(s.cutoff).toBe(FF_NONBONDED_CUTOFF_A.uff);
  });

  it("large system uses LinkedCell at FF cutoff", () => {
    const s = LbfgsNeighborStrategy.forMethod("uff", 5_000, {
      hasPeriodicBox: true,
    });
    expect(s.algorithm).toBe("linked_cell");
  });

  it("createLbfgs works for both algorithms", () => {
    const frame = new Frame();
    const ab = new Block();
    ab.setColF("x", new Float64Array([0, 1.5, 2.3]));
    ab.setColF("y", new Float64Array([0, 0, 0.5]));
    ab.setColF("z", new Float64Array([0, 0, 0]));
    ab.setColStr("element", ["C", "C", "O"]);
    frame.insertBlock("atoms", ab);
    const bb = new Block();
    bb.setColU32("atomi", new Uint32Array([0, 1]));
    bb.setColU32("atomj", new Uint32Array([1, 2]));
    bb.setColU32("bond_type", new Uint32Array([1, 1]));
    bb.setColU32("bond_number", new Uint32Array([1, 1]));
    frame.insertBlock("bonds", bb);

    const typ = new UFFTypifier();
    try {
      const typed = typ.typify(frame);
      const pots = typ.toPotentials(typed);

      for (const [algo, n] of [
        ["bruteforce", 10],
        ["linked_cell", 5_000],
      ] as const) {
        const strategy = LbfgsNeighborStrategy.forMethod("uff", n, {
          hasPeriodicBox: algo === "linked_cell",
        });
        expect(strategy.algorithm).toBe(algo);
        const prep = strategy.prepare(typed);
        try {
          const opt = prep.createLbfgs(pots, 0.1);
          try {
            const report = opt.run(typed, 3);
            expect(Number.isFinite(report.energy)).toBe(true);
            report.free();
          } finally {
            opt.free();
          }
        } finally {
          prep.free();
        }
      }

      pots.free();
      typed.free();
    } finally {
      typ.free();
      frame.free();
    }
  });
});
