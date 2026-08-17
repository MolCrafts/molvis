import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { DrawBoxModifier } from "../../src/pipeline/draw_box";
import type { PipelineContext } from "../../src/pipeline/types";

function makePeriodicFrame(): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array([0, 1]));
  atoms.setColF("y", new Float64Array([0, 0]));
  atoms.setColF("z", new Float64Array([0, 0]));
  frame.insertBlock("atoms", atoms);
  frame.box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);
  return frame;
}

function testContext(showBox = true): PipelineContext {
  const app = {
    styleManager: { getShowBox: () => showBox },
    artist: { drawBox: () => {} },
  } as unknown as PipelineContext["app"];
  return {
    selectionSet: new Map(),
    currentSelection: undefined as never,
    selectedBondIds: [],
    suppressHighlight: false,
    postRenderEffects: [],
    selectionCache: new Map(),
    app,
    changeKind: "full",
  } as unknown as PipelineContext;
}

describe("DrawBoxModifier", () => {
  it("does not free frame-owned box so later volume reads still work", () => {
    // Regression: apply() used to free(input.box), which corrupted the
    // frame handle and made RDF / box reads fail after any pipeline pass.
    const frame = makePeriodicFrame();
    const mod = new DrawBoxModifier();
    mod.apply(frame, testContext());

    const box = frame.box;
    expect(box).toBeTruthy();
    expect(box!.volume()).toBeCloseTo(1000, 6);
  });

  it("manual box path leaves the frame-owned box intact", () => {
    const frame = makePeriodicFrame();
    const mod = new DrawBoxModifier("draw-box", {
      lengths: [5, 5, 5],
      tilts: [0, 0, 0],
      origin: [0, 0, 0],
      pbc: [true, true, true],
    });
    const out = mod.apply(frame, testContext());
    // Input frame's lattice is never freed / overwritten.
    expect(frame.box!.volume()).toBeCloseTo(1000, 6);
    // Output frame carries the manual cell for downstream consumers.
    expect(out.box!.volume()).toBeCloseTo(125, 6);
  });

  it("builds a tilted cell from LAMMPS xy/xz/yz factors", () => {
    const frame = makePeriodicFrame();
    const mod = new DrawBoxModifier("draw-box", {
      lengths: [10, 10, 10],
      tilts: [2, 1, 0.5],
      origin: [0, 0, 0],
      pbc: [true, true, true],
    });
    const out = mod.apply(frame, testContext());
    const t = out.box!.tilts().toCopy();
    try {
      expect(t[0]).toBeCloseTo(2, 6);
      expect(t[1]).toBeCloseTo(1, 6);
      expect(t[2]).toBeCloseTo(0.5, 6);
    } finally {
      // tilts() returns a WasmArray — free after copy.
    }
  });

  it("manual box writes frame.box even when the wireframe is hidden", () => {
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([0]));
    atoms.setColF("y", new Float64Array([0]));
    atoms.setColF("z", new Float64Array([0]));
    frame.insertBlock("atoms", atoms);

    const mod = new DrawBoxModifier("draw-box", {
      lengths: [10, 10, 10],
      tilts: [0, 0, 0],
      origin: [0, 0, 0],
      pbc: [true, true, true],
    });
    expect(mod.providesFrameBox).toBe(true);

    const out = mod.apply(frame, testContext(false));
    // Data path: box is on the frame regardless of mesh visibility.
    expect(out.box).toBeTruthy();
    expect(out.box!.volume()).toBeCloseTo(1000, 6);
    // Immutability: input frame is left untouched.
    expect(frame.box).toBeUndefined();
  });
});
