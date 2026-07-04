import { Block, Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { buildAtomBuffers } from "../../src/artist/atom_buffer";
import {
  buildCategoricalColorLookup,
  getCategoricalPalette,
} from "../../src/artist/palette";
import type { StyleManager } from "../../src/artist/style_manager";
import {
  COLOR_OVERRIDE_B,
  COLOR_OVERRIDE_G,
  COLOR_OVERRIDE_R,
  ColorByPropertyModifier,
} from "../../src/modifiers/ColorByPropertyModifier";
import { createDefaultContext } from "../../src/pipeline/types";

// StyleManager only supplies radius for __color-override frames; mock it like
// core/tests/atom_buffer.test.ts (a real StyleManager needs a Babylon Scene).
function makeStyleManager(): StyleManager {
  return {
    getTypeStyle: () => ({ color: "#111111", radius: 0.4, alpha: 1 }),
    getAtomStyle: () => ({ color: "#111111", radius: 0.4, alpha: 1 }),
  } as StyleManager;
}

/** Atoms block with x/y/z F64 + element string, optional Int32 source_id. */
function makeAtoms(sourceIds?: number[]): Frame {
  const count = sourceIds ? sourceIds.length : 1;
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF(
    "x",
    new Float64Array(Array.from({ length: count }, (_, i) => i)),
  );
  atoms.setColF("y", new Float64Array(count));
  atoms.setColF("z", new Float64Array(count));
  atoms.setColStr(
    "element",
    Array.from({ length: count }, () => "C"),
  );
  if (sourceIds) {
    atoms.setColI32("source_id", new Int32Array(sourceIds));
  }
  frame.insertBlock("atoms", atoms);
  return frame;
}

/** Frame with a numeric F64 column (e.g. charge) and no source_id. */
function makeCharged(charges: number[]): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array(charges.map((_, i) => i)));
  atoms.setColF("y", new Float64Array(charges.length));
  atoms.setColF("z", new Float64Array(charges.length));
  atoms.setColStr(
    "element",
    charges.map(() => "C"),
  );
  atoms.setColF("charge", new Float64Array(charges));
  frame.insertBlock("atoms", atoms);
  return frame;
}

function readTriple(
  frame: Frame,
  row: number,
): [number, number, number] | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms) return null;
  const r = atoms.viewColF(COLOR_OVERRIDE_R);
  const g = atoms.viewColF(COLOR_OVERRIDE_G);
  const b = atoms.viewColF(COLOR_OVERRIDE_B);
  if (!r || !g || !b) return null;
  return [r[row], g[row], b[row]];
}

function makeCategoricalSourceModifier(): ColorByPropertyModifier {
  const mod = new ColorByPropertyModifier();
  mod.columnName = "source_id";
  mod.categorical = true;
  return mod;
}

describe("ColorByPropertyModifier — categorical numeric (source_id)", () => {
  it("ac-001: categorical numeric column injects distinct __color triples per source", () => {
    const mod = makeCategoricalSourceModifier();
    const frame = makeAtoms([0, 0, 1, 1, 2]);
    const ctx = createDefaultContext(frame);
    const result = mod.apply(frame, ctx);

    const atoms = result.getBlock("atoms");
    expect(atoms).toBeTruthy();
    expect(atoms?.dtype(COLOR_OVERRIDE_R)).toBeTruthy();
    expect(atoms?.dtype(COLOR_OVERRIDE_G)).toBeTruthy();
    expect(atoms?.dtype(COLOR_OVERRIDE_B)).toBeTruthy();

    const triple0 = readTriple(result, 0);
    const triple1 = readTriple(result, 2);
    const triple2 = readTriple(result, 4);
    expect(triple0).not.toEqual(triple1);
    expect(triple0).not.toEqual(triple2);
    expect(triple1).not.toEqual(triple2);
  });

  it("ac-002: deterministic; j-th distinct source maps to categorical palette ordinal j", () => {
    const frameA = makeAtoms([0, 0, 1, 1, 2]);
    const frameB = makeAtoms([0, 0, 1, 1, 2]);
    const modA = makeCategoricalSourceModifier();
    const modB = makeCategoricalSourceModifier();
    const resA = modA.apply(frameA, createDefaultContext(frameA));
    const resB = modB.apply(frameB, createDefaultContext(frameB));

    expect(readTriple(resA, 0)).toEqual(readTriple(resB, 0));
    expect(readTriple(resA, 2)).toEqual(readTriple(resB, 2));
    expect(readTriple(resA, 4)).toEqual(readTriple(resB, 4));

    const lookup = buildCategoricalColorLookup(["0", "1", "2"]);
    expect(readTriple(resA, 0)).toEqual(lookup.get("0"));
    expect(readTriple(resA, 2)).toEqual(lookup.get("1"));
    expect(readTriple(resA, 4)).toEqual(lookup.get("2"));
  });

  it("ac-003: beyond the curated palette colors are generated, not wrapped", () => {
    const paletteLen = getCategoricalPalette().length;
    const sourceIds = Array.from({ length: paletteLen + 1 }, (_, i) => i);
    const frame = makeAtoms(sourceIds);
    const mod = makeCategoricalSourceModifier();

    const result = mod.apply(frame, createDefaultContext(frame));
    const tripleFirst = readTriple(result, 0);
    const tripleOverflow = readTriple(result, paletteLen);
    expect(tripleFirst).not.toBeNull();
    // No modulo collision: the (paletteLen)-th source gets its own generated
    // soft color rather than reusing the first palette entry.
    expect(tripleOverflow).not.toEqual(tripleFirst);
    expect(tripleOverflow).not.toBeNull();
  });

  it("ac-004: isApplicable gated on source_id presence; missing column injects nothing", () => {
    const mod = new ColorByPropertyModifier();
    mod.columnName = "source_id";

    const without = makeAtoms();
    const withCol = makeAtoms([0, 1]);
    expect(mod.isApplicable(without)).toBe(false);
    expect(mod.isApplicable(withCol)).toBe(true);

    const result = mod.apply(without, createDefaultContext(without));
    const atoms = result.getBlock("atoms");
    expect(atoms?.dtype(COLOR_OVERRIDE_R)).toBeFalsy();
  });

  it("ac-005: categorical=false on numeric column keeps viridis ramp and differs from categorical mode", () => {
    const charges = [0, 0.25, 0.5, 0.75, 1];

    const continuous = new ColorByPropertyModifier();
    continuous.columnName = "charge";
    const contFrame = makeCharged(charges);
    const contResult = continuous.apply(
      contFrame,
      createDefaultContext(contFrame),
    );
    const contAtoms = contResult.getBlock("atoms");
    expect(contAtoms?.dtype(COLOR_OVERRIDE_R)).toBeTruthy();

    // Distinct numeric values give distinct continuous colors.
    expect(readTriple(contResult, 0)).not.toEqual(readTriple(contResult, 4));

    // Categorical mode over the same column gives different colors than viridis.
    const categorical = new ColorByPropertyModifier();
    categorical.columnName = "charge";
    categorical.categorical = true;
    const catFrame = makeCharged(charges);
    const catResult = categorical.apply(
      catFrame,
      createDefaultContext(catFrame),
    );
    expect(readTriple(catResult, 0)).not.toEqual(readTriple(contResult, 0));
  });

  it("ac-006: re-applying the same instance derives identical colors (config-owned, not buffer-owned)", () => {
    const mod = makeCategoricalSourceModifier();

    const frame1 = makeAtoms([0, 1, 2]);
    const res1 = mod.apply(frame1, createDefaultContext(frame1));
    const triples1 = [0, 1, 2].map((row) => readTriple(res1, row));

    const frame2 = makeAtoms([0, 1, 2]);
    const res2 = mod.apply(frame2, createDefaultContext(frame2));
    const triples2 = [0, 1, 2].map((row) => readTriple(res2, row));

    expect(triples2).toEqual(triples1);
  });

  it("ac-007: getCacheKey differs between categorical=true and categorical=false", () => {
    const off = new ColorByPropertyModifier();
    off.columnName = "source_id";
    off.categorical = false;
    const keyOff = off.getCacheKey();

    const on = new ColorByPropertyModifier();
    on.columnName = "source_id";
    on.categorical = true;
    const keyOn = on.getCacheKey();

    expect(keyOn).not.toBe(keyOff);
  });

  it("ac-009: buildAtomBuffers honors injected __color override over default colors", () => {
    const mod = makeCategoricalSourceModifier();
    const frame = makeAtoms([0, 1, 2]);
    const result = mod.apply(frame, createDefaultContext(frame));
    const atoms = result.getBlock("atoms");
    expect(atoms).toBeTruthy();
    if (!atoms) return;

    const buffers = buildAtomBuffers(atoms, makeStyleManager(), 0);
    const instanceColor = buffers.get("instanceColor");
    expect(instanceColor).toBeTruthy();
    if (!instanceColor) return;

    const expected0 = readTriple(result, 0);
    const expected1 = readTriple(result, 1);
    expect(expected0).not.toBeNull();
    expect(expected1).not.toBeNull();
    if (!expected0 || !expected1) return;

    // instanceColor is RGBA, stride 4.
    expect(instanceColor[0]).toBeCloseTo(expected0[0], 5);
    expect(instanceColor[1]).toBeCloseTo(expected0[1], 5);
    expect(instanceColor[2]).toBeCloseTo(expected0[2], 5);
    expect(instanceColor[4]).toBeCloseTo(expected1[0], 5);
    expect(instanceColor[5]).toBeCloseTo(expected1[1], 5);
    expect(instanceColor[6]).toBeCloseTo(expected1[2], 5);

    // Different sources → different rendered colors (override, not flat default).
    expect([instanceColor[0], instanceColor[1], instanceColor[2]]).not.toEqual([
      instanceColor[4],
      instanceColor[5],
      instanceColor[6],
    ]);
  });
});
