import { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { hexToLinearRgb } from "../../src/artist/palette";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
} from "../../src/color_override_keys";
import { SolidLiquidModifier } from "../../src/modifiers/SolidLiquidModifier";
import { SteinhardtOrderModifier } from "../../src/modifiers/SteinhardtOrderModifier";
import {
  applyColumnColors,
  SOLID_LIQUID_COLUMN,
  SOLID_LIQUID_N_BONDS_COLUMN,
  steinhardtQColumn,
  writeAtomF64Column,
} from "../../src/modifiers/structure_order_shared";
import type { PipelineContext } from "../../src/pipeline/types";
import { createDefaultContext } from "../../src/pipeline/types";

/** Simple cubic lattice with enough neighbors for Steinhardt at cutoff ~1.5. */
function scLattice(n = 3, spacing = 1.0): Frame {
  const frame = new Frame();
  const atoms = frame.createBlock("atoms");
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        xs.push(i * spacing);
        ys.push(j * spacing);
        zs.push(k * spacing);
      }
    }
  }
  atoms.setColF("x", Float64Array.from(xs));
  atoms.setColF("y", Float64Array.from(ys));
  atoms.setColF("z", Float64Array.from(zs));
  const L = (n - 1) * spacing + 2;
  frame.box = Box.cube(L, new Float64Array([0, 0, 0]), true, true, true);
  return frame;
}

function dummyCtx(frame: Frame): PipelineContext {
  return createDefaultContext(frame, {} as never);
}

describe("SteinhardtOrderModifier", () => {
  it("writes steinhardt_q6 and color overrides when colorScene is on", () => {
    const frame = scLattice();
    const mod = new SteinhardtOrderModifier();
    mod.setLValues([6]);
    mod.setCutoff(1.5);
    mod.setColorScene(true);
    mod.setColorL(6);

    const out = mod.apply(frame, dummyCtx(frame));
    const atoms = out.getBlock("atoms");
    expect(atoms).toBeTruthy();
    expect(atoms?.dtype(steinhardtQColumn(6))).toBe("f64");
    const ql = atoms?.viewColF(steinhardtQColumn(6));
    expect(ql?.length).toBe(27);
    // Colors injected for scene path
    expect(atoms?.dtype(COLOR_OVERRIDE_R)).toBe("f64");

    if (out !== frame) out.free();
    frame.free();
  });

  it("writes columns without colors when colorScene is off", () => {
    const frame = scLattice();
    const mod = new SteinhardtOrderModifier();
    mod.setColorScene(false);
    const out = mod.apply(frame, dummyCtx(frame));
    const atoms = out.getBlock("atoms");
    expect(atoms?.dtype(steinhardtQColumn(6))).toBe("f64");
    expect(atoms?.dtype(COLOR_OVERRIDE_R)).toBeUndefined();
    if (out !== frame) out.free();
    frame.free();
  });
});

describe("applyColumnColors", () => {
  it("writes explicit category→RGB without viridis", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    writeAtomF64Column(atoms, "flag", [0, 1]);
    applyColumnColors(atoms, "flag", {
      categorical: true,
      categoryColors: {
        "0": [0.1, 0.2, 0.3],
        "1": [0.4, 0.5, 0.6],
      },
    });
    expect(Array.from(atoms.viewColF(COLOR_OVERRIDE_R) ?? [])).toEqual([
      0.1, 0.4,
    ]);
    expect(Array.from(atoms.viewColF(COLOR_OVERRIDE_G) ?? [])).toEqual([
      0.2, 0.5,
    ]);
    expect(Array.from(atoms.viewColF(COLOR_OVERRIDE_B) ?? [])).toEqual([
      0.3, 0.6,
    ]);
    frame.free();
  });
});

describe("SolidLiquidModifier", () => {
  it("defaults liquid/solid to Tab10 hex and includes them in the cache key", () => {
    const mod = new SolidLiquidModifier();
    expect(mod.liquidColor).toBe("#4E79A7");
    expect(mod.solidColor).toBe("#E15759");
    const key = mod.getCacheKey();
    expect(key).toContain("#4E79A7");
    expect(key).toContain("#E15759");
    mod.setLiquidColor("#00FF00");
    expect(mod.getCacheKey()).not.toBe(key);
    const afterLiquid = mod.getCacheKey();
    expect(afterLiquid).toContain("#00FF00");
    mod.setSolidColor("#0000FF");
    expect(mod.getCacheKey()).not.toBe(afterLiquid);
    expect(mod.getCacheKey()).toContain("#0000FF");
  });

  it("writes solid_liquid and Tab10 linear RGB when colorScene is on", () => {
    const frame = scLattice();
    const mod = new SolidLiquidModifier();
    mod.setCutoff(1.5);
    mod.setColorScene(true);

    const out = mod.apply(frame, dummyCtx(frame));
    const atoms = out.getBlock("atoms");
    expect(atoms?.dtype(SOLID_LIQUID_COLUMN)).toBe("f64");
    expect(atoms?.dtype(SOLID_LIQUID_N_BONDS_COLUMN)).toBe("f64");
    const solid = atoms?.viewColF(SOLID_LIQUID_COLUMN);
    expect(solid?.length).toBe(27);
    const r = atoms?.viewColF(COLOR_OVERRIDE_R);
    const g = atoms?.viewColF(COLOR_OVERRIDE_G);
    const b = atoms?.viewColF(COLOR_OVERRIDE_B);
    expect(r?.length).toBe(27);
    const liquidRgb = hexToLinearRgb("#4E79A7");
    const solidRgb = hexToLinearRgb("#E15759");
    for (let i = 0; i < (solid?.length ?? 0); i++) {
      expect(solid![i] === 0 || solid![i] === 1).toBe(true);
      const want = solid![i] === 0 ? liquidRgb : solidRgb;
      expect(r![i]).toBeCloseTo(want[0], 5);
      expect(g![i]).toBeCloseTo(want[1], 5);
      expect(b![i]).toBeCloseTo(want[2], 5);
    }

    if (out !== frame) out.free();
    frame.free();
  });

  it("rewrites overrides after setLiquidColor/setSolidColor", () => {
    const frame = scLattice();
    const mod = new SolidLiquidModifier();
    mod.setCutoff(1.5);
    mod.setColorScene(true);
    mod.setLiquidColor("#00FF00");
    mod.setSolidColor("#0000FF");

    const out = mod.apply(frame, dummyCtx(frame));
    const atoms = out.getBlock("atoms");
    const solid = atoms?.viewColF(SOLID_LIQUID_COLUMN);
    const r = atoms?.viewColF(COLOR_OVERRIDE_R);
    const g = atoms?.viewColF(COLOR_OVERRIDE_G);
    const b = atoms?.viewColF(COLOR_OVERRIDE_B);
    const liquidRgb = hexToLinearRgb("#00FF00");
    const solidRgb = hexToLinearRgb("#0000FF");
    expect(liquidRgb).toEqual([0, 1, 0]);
    expect(solidRgb).toEqual([0, 0, 1]);
    for (let i = 0; i < (solid?.length ?? 0); i++) {
      const want = solid![i] === 0 ? liquidRgb : solidRgb;
      expect(r![i]).toBeCloseTo(want[0], 5);
      expect(g![i]).toBeCloseTo(want[1], 5);
      expect(b![i]).toBeCloseTo(want[2], 5);
    }

    if (out !== frame) out.free();
    frame.free();
  });

  it("writes columns without colors when colorScene is off", () => {
    const frame = scLattice();
    const mod = new SolidLiquidModifier();
    mod.setCutoff(1.5);
    mod.setColorScene(false);
    const out = mod.apply(frame, dummyCtx(frame));
    const atoms = out.getBlock("atoms");
    expect(atoms?.dtype(SOLID_LIQUID_COLUMN)).toBe("f64");
    expect(atoms?.dtype(SOLID_LIQUID_N_BONDS_COLUMN)).toBe("f64");
    expect(atoms?.dtype(COLOR_OVERRIDE_R)).toBeUndefined();
    if (out !== frame) out.free();
    frame.free();
  });
});
