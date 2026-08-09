import {
  type Frame,
  generate3D,
  parseSMILES,
} from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  assessFrameForOptimize,
  assessOptimizeAtomTypes,
  assessOptimizeSize,
  estimateOptimizePeakBytes,
  estimateSoftPairs,
  isMolrsPotential,
  LBFGS_MAX_ATOMS,
  resolveOptimizeMemoryBudget,
  resolveOptimizePair,
  runDampedOptimize,
  runLbfgsOptimize,
  softPairBudget,
} from "../../src/optimize/relax";

function ethanol3d(): Frame {
  const ir = parseSMILES("CCO");
  const f2 = ir.toFrame();
  ir.free?.();
  const f3 = generate3D(f2, "fast", 1);
  f2.free();
  return f3;
}

function bondStretch(
  frame: Frame,
  atomI: number,
  atomJ: number,
  scale: number,
): void {
  const atoms = frame.getBlock("atoms");
  if (!atoms) throw new Error("no atoms");
  const x = atoms.copyColF("x")!;
  const y = atoms.copyColF("y")!;
  const z = atoms.copyColF("z")!;
  // Pull atomJ away from atomI along the bond vector.
  const dx = x[atomJ] - x[atomI];
  const dy = y[atomJ] - y[atomI];
  const dz = z[atomJ] - z[atomI];
  x[atomJ] = x[atomI] + dx * scale;
  y[atomJ] = y[atomI] + dy * scale;
  z[atomJ] = z[atomI] + dz * scale;
  atoms.setColF("x", x);
  atoms.setColF("y", y);
  atoms.setColF("z", z);
  atoms.free();
}

describe("optimize size / memory gates", () => {
  it("estimateSoftPairs is N*(N-1)/2", () => {
    expect(estimateSoftPairs(0)).toBe(0);
    expect(estimateSoftPairs(1)).toBe(0);
    expect(estimateSoftPairs(100)).toBe(4950);
  });

  it("softPairBudget scales with √deviceMemory", () => {
    const b4 = softPairBudget(4);
    const b16 = softPairBudget(16);
    expect(b16).toBeGreaterThan(b4);
    expect(softPairBudget(null)).toBe(b4);
  });

  it("estimateOptimizePeakBytes is higher for LBFGS than soft at same N", () => {
    const soft = estimateOptimizePeakBytes(1000, "soft");
    const uff = estimateOptimizePeakBytes(1000, "uff");
    expect(uff).toBeGreaterThan(soft);
    expect(soft).toBeGreaterThan(0);
  });

  it("resolveOptimizeMemoryBudget returns positive budget", () => {
    const b = resolveOptimizeMemoryBudget({});
    expect(b.budgetBytes).toBeGreaterThan(0);
  });

  it("assessOptimizeSize hard-blocks over LBFGS_MAX_ATOMS for molrs potentials", () => {
    const over = assessOptimizeSize(LBFGS_MAX_ATOMS + 1, "uff", {
      deviceMemoryGiB: 64,
      jsHeapSizeLimit: 8 * 1024 ** 3,
    });
    expect(over.level).toBe("hard_block");
  });

  it("isMolrsPotential classifies potentials", () => {
    expect(isMolrsPotential("uff")).toBe(true);
    expect(isMolrsPotential("mmff94")).toBe(true);
    expect(isMolrsPotential("mmff94s")).toBe(true);
    expect(isMolrsPotential("soft")).toBe(false);
    expect(isMolrsPotential("gfnff")).toBe(false);
  });

  it("resolveOptimizePair defaults and rejects illegal combos", () => {
    expect(resolveOptimizePair("uff")).toEqual({
      potential: "uff",
      optimizer: "lbfgs",
    });
    expect(resolveOptimizePair("soft")).toEqual({
      potential: "soft",
      optimizer: "damped",
    });
    expect(() => resolveOptimizePair("soft", "lbfgs")).toThrow(/damped/);
    expect(() => resolveOptimizePair("uff", "damped")).toThrow(/lbfgs/);
  });

  it("runLbfgsOptimize UFF lowers force on distorted ethanol", async () => {
    const frame = ethanol3d();
    try {
      bondStretch(frame, 0, 1, 1.35);
      const report = await runLbfgsOptimize({
        frame,
        potential: "uff",
        maxSteps: 80,
        forceTol: 0.1,
        reportEvery: 20,
      });
      expect(report.steps).toBeGreaterThan(0);
      expect(Number.isFinite(report.energy)).toBe(true);
      expect(report.cancelled).toBe(false);
      expect(report.maxForce).toBeLessThan(50);
    } finally {
      frame.free();
    }
  });

  it("runLbfgsOptimize MMFF94 lowers force on distorted ethanol", async () => {
    const frame = ethanol3d();
    try {
      bondStretch(frame, 0, 1, 1.35);
      const report = await runLbfgsOptimize({
        frame,
        potential: "mmff94",
        maxSteps: 80,
        forceTol: 0.1,
        reportEvery: 20,
      });
      expect(report.steps).toBeGreaterThan(0);
      expect(Number.isFinite(report.energy)).toBe(true);
      expect(report.cancelled).toBe(false);
      expect(report.maxForce).toBeLessThan(50);
    } finally {
      frame.free();
    }
  });

  it("runDampedOptimize rejects non-soft potentials", async () => {
    await expect(
      runDampedOptimize({
        coords: new Float64Array([0, 0, 0, 1, 0, 0]),
        elements: ["C", "C"],
        bonds: [[0, 1]],
        // @ts-expect-error intentional bad potential
        potential: "mmff94",
        maxSteps: 1,
      }),
    ).rejects.toThrow(/runLbfgsOptimize|soft/);
  });

  it("assessOptimizeAtomTypes blocks missing elements", () => {
    const r = assessOptimizeAtomTypes(["C", "", "N", "-"], "uff");
    expect(r.level).toBe("block");
    expect(r.missingElementCount).toBe(2);
    expect(r.message).toMatch(/Missing\/invalid element/i);
    expect(r.issues.some((i) => /#1=/i.test(i))).toBe(true);
  });

  it("assessOptimizeAtomTypes blocks MMFF metals (e.g. Mg) with UFF hint", () => {
    // 9Y9F-like: organic atoms + Mg ions
    const els = [
      ...Array.from({ length: 20 }, () => "C"),
      "Mg",
      "Mg",
      "O",
      "N",
    ];
    const r = assessOptimizeAtomTypes(els, "mmff94");
    expect(r.level).toBe("block");
    expect(r.unsupportedForMethod.Mg).toBe(2);
    expect(r.message).toMatch(/MMFF94|organic|UFF/i);
    expect(r.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("assessOptimizeAtomTypes allows the same metals under UFF", () => {
    const r = assessOptimizeAtomTypes(["C", "Mg", "O", "N"], "uff");
    expect(r.level).toBe("ok");
    expect(Object.keys(r.unsupportedForMethod)).toHaveLength(0);
  });

  it("assessOptimizeAtomTypes warns on large MMFF systems", () => {
    const els = Array.from({ length: 600 }, () => "C");
    const r = assessOptimizeAtomTypes(els, "mmff94");
    expect(r.level).toBe("warn");
    expect(r.message).toMatch(/beyond typical MMFF|UFF/i);
  });

  it("runLbfgsOptimize fails fast on missing element symbols", async () => {
    const { Block, Frame } = await import("@molcrafts/molvis-core/molrs");
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0, 1.5]));
    atoms.setColF("y", new Float64Array([0, 0]));
    atoms.setColF("z", new Float64Array([0, 0]));
    atoms.setColStr("element", ["C", ""]);
    frame.insertBlock("atoms", atoms);
    try {
      await expect(
        runLbfgsOptimize({
          frame,
          potential: "mmff94",
          maxSteps: 1,
        }),
      ).rejects.toThrow(
        /Missing\/invalid element|force-field setup \(mmff94\)/i,
      );
    } finally {
      frame.free();
    }
  });

  it("MMFF setup fails preflight on Fe with UFF guidance", async () => {
    const { Block, Frame } = await import("@molcrafts/molvis-core/molrs");
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0]));
    atoms.setColF("y", new Float64Array([0]));
    atoms.setColF("z", new Float64Array([0]));
    atoms.setColStr("element", ["Fe"]);
    frame.insertBlock("atoms", atoms);
    try {
      await expect(
        runLbfgsOptimize({
          frame,
          potential: "mmff94",
          maxSteps: 1,
        }),
      ).rejects.toThrow(
        /outside its organic set|Switch method to UFF|force-field setup/i,
      );
    } finally {
      frame.free();
    }
  });

  it("assessFrameForOptimize surfaces missing element column", async () => {
    const { Block, Frame } = await import("@molcrafts/molvis-core/molrs");
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0]));
    atoms.setColF("y", new Float64Array([0]));
    atoms.setColF("z", new Float64Array([0]));
    // no element column
    frame.insertBlock("atoms", atoms);
    try {
      const r = assessFrameForOptimize(frame, "uff");
      expect(r.level).toBe("block");
      expect(r.message).toMatch(/no element column/i);
    } finally {
      frame.free();
    }
  });

  it("soft spring path still runs (damped + soft)", async () => {
    const coords = new Float64Array([0, 0, 0, 2.5, 0, 0]);
    const r = await runDampedOptimize({
      coords,
      elements: ["C", "C"],
      bonds: [[0, 1]],
      potential: "soft",
      maxSteps: 30,
      forceTol: 0.2,
    });
    expect(r.steps).toBeGreaterThan(0);
    // Bond should shorten toward ~1.5 Å (2× covalent C radius).
    const dx = coords[3] - coords[0];
    expect(Math.abs(dx)).toBeLessThan(2.5);
  });
});

describe("relax force-field LBFGS scale", () => {
  it("runLbfgsOptimize handles 20k atoms (no O(N²) panic)", async () => {
    const { Block, Frame } = await import("@molcrafts/molvis-core/molrs");
    const n = 20_000;
    const frame = new Frame();
    const ab = new Block();
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const z = new Float64Array(n);
    const els: string[] = [];
    const side = Math.ceil(Math.cbrt(n));
    for (let i = 0; i < n; i++) {
      x[i] = (i % side) * 3.5;
      y[i] = (Math.floor(i / side) % side) * 3.5;
      z[i] = Math.floor(i / (side * side)) * 3.5;
      els.push(i % 3 === 0 ? "O" : "C");
    }
    ab.setColF("x", x);
    ab.setColF("y", y);
    ab.setColF("z", z);
    ab.setColStr("element", els);
    frame.insertBlock("atoms", ab);
    try {
      const report = await runLbfgsOptimize({
        frame,
        potential: "uff",
        maxSteps: 2,
        reportEvery: 1,
        forceTol: 1.0,
      });
      expect(report.steps).toBeGreaterThan(0);
      expect(Number.isFinite(report.energy)).toBe(true);
      expect(report.cancelled).toBe(false);
    } finally {
      frame.free();
    }
  }, 120_000);
});
