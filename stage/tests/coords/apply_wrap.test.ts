/**
 * System wrap gate — atom columns only. Edge-bond continuity is draw-time MI.
 */
import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { toDomainUint } from "@molcrafts/molvis-core";
import {
  applyWrapIfEnabled,
  wrapAtoms,
  wrapEnabledFromLegacy,
} from "../../src/coords";
import { DrawBoxModifier } from "../../src/pipeline/draw_box";
import { createDefaultContext } from "../../src/pipeline/types";

function makeFrame(
  positions: [number, number, number][],
  box?: Box,
  bonds?: Array<[number, number]>,
): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array(positions.map((p) => p[0])));
  atoms.set("y", new Float64Array(positions.map((p) => p[1])));
  atoms.set("z", new Float64Array(positions.map((p) => p[2])));
  frame.set("atoms", atoms);
  if (bonds && bonds.length > 0) {
    const b = new Block();
    b.set("atomi", toDomainUint(bonds.map((p) => p[0])));
    b.set("atomj", toDomainUint(bonds.map((p) => p[1])));
    b.set("bond_type", toDomainUint(bonds.map(() => 1)));
    b.set("bond_number", toDomainUint(bonds.map(() => 1)));
    frame.set("bonds", b);
  }
  if (box) frame.box = box;
  return frame;
}

function orthoBox(L = 10): Box {
  return Box.ortho(
    new Float64Array([L, L, L]),
    new Float64Array([0, 0, 0]),
    true,
    true,
    true,
  );
}

/** Ortho minimum-image stick length (same geometry Artist gets from Box.delta). */
function orthoMiBondLength(
  L: number,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): number {
  let dx = x1 - x0;
  let dy = y1 - y0;
  let dz = z1 - z0;
  if (dx > L / 2) dx -= L;
  else if (dx < -L / 2) dx += L;
  if (dy > L / 2) dy -= L;
  else if (dy < -L / 2) dy += L;
  if (dz > L / 2) dz -= L;
  else if (dz < -L / 2) dz += L;
  return Math.hypot(dx, dy, dz);
}

describe("applyWrapIfEnabled", () => {
  it("is a no-op when wrap is off", () => {
    const box = orthoBox(10);
    const frame = makeFrame([[12, 1, 1]], box);
    const out = applyWrapIfEnabled(frame, false);
    expect(out).toBe(frame);
  });

  it("folds isolated atoms into the primary cell when wrap is on", () => {
    const box = orthoBox(10);
    const frame = makeFrame(
      [
        [12, 1, 1],
        [-3, 5, 5],
        [5, 5, 5],
      ],
      box,
    );
    const out = applyWrapIfEnabled(frame, true);
    const x = (out.get("atoms").view("x") as Float64Array)!;
    expect(x[0]).toBeCloseTo(2, 6);
    expect(x[1]).toBeCloseTo(7, 6);
    expect(x[2]).toBeCloseTo(5, 6);
  });

  it("skips when frame has no usable box", () => {
    const frame = makeFrame([[12, 1, 1]]);
    const out = applyWrapIfEnabled(frame, true);
    expect(out).toBe(frame);
  });

  it("folds after a manual Simulation cell has written frame.box", () => {
    const bare = makeFrame([
      [12, 1, 1],
      [-3, 5, 5],
    ]);
    const drawBox = new DrawBoxModifier("draw-box", {
      lengths: [10, 10, 10],
      tilts: [0, 0, 0],
      origin: [0, 0, 0],
      pbc: [true, true, true],
    });
    const withBox = drawBox.apply(bare, withBoxStub(bare));
    const out = applyWrapIfEnabled(withBox, true);
    const x = (out.get("atoms").view("x") as Float64Array)!;
    expect(x[0]).toBeCloseTo(2, 6);
    expect(x[1]).toBeCloseTo(7, 6);
  });

  it("puts straddling dimer atoms in the cell; MI stick length stays ~1 Å", () => {
    const box = orthoBox(10);
    const frame = makeFrame(
      [
        [9.5, 0, 0],
        [10.5, 0, 0],
      ],
      box,
      [[0, 1]],
    );
    const out = applyWrapIfEnabled(frame, true);
    const atoms = out.get("atoms");
    const x = (atoms.view("x") as Float64Array)!;
    const y = (atoms.view("y") as Float64Array)!;
    const z = (atoms.view("z") as Float64Array)!;
    expect(x[0]).toBeCloseTo(9.5, 6);
    expect(x[1]).toBeCloseTo(0.5, 6);
    // Raw Cartesian length would be ~9 Å across the cell; MI is the draw path.
    expect(Math.abs(x[1] - x[0])).toBeGreaterThan(5);
    expect(
      orthoMiBondLength(10, x[0], y[0], z[0], x[1], y[1], z[1]),
    ).toBeCloseTo(1.0, 5);
  });

  it("wrapAtoms batches free atoms", () => {
    const box = orthoBox(10);
    const out = wrapAtoms(
      box,
      new Float64Array([12, -1]),
      new Float64Array([0, 0]),
      new Float64Array([0, 0]),
      2,
    );
    expect(out.x[0]).toBeCloseTo(2, 6);
    expect(out.x[1]).toBeCloseTo(9, 6);
  });

  it("maps legacy policy strings onto wrapEnabled", () => {
    expect(wrapEnabledFromLegacy("as-deposited")).toBe(false);
    expect(wrapEnabledFromLegacy("unwrap-trajectory")).toBe(false);
    expect(wrapEnabledFromLegacy("wrap-atoms")).toBe(true);
    expect(wrapEnabledFromLegacy("wrap-molecules")).toBe(true);
    expect(wrapEnabledFromLegacy("wrap")).toBe(true);
  });
});

function withBoxStub(frame: Frame) {
  return createDefaultContext(frame, {
    styleManager: { getShowBox: () => true },
    artist: { drawBox: () => {} },
  } as never);
}
