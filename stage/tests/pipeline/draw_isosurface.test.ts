import { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { DrawIsosurfaceModifier } from "../../src/pipeline/draw_isosurface";

/** Synthetic grid + simbox for match/channel unit tests. */
function syntheticGridFrame(nx: number, ny: number, nz: number): Frame {
  const frame = new Frame();
  const grid = frame.createBlock("grid");
  const data = new Float64Array(nx * ny * nz);
  grid.setColF("density", data);
  grid.setShape(new Uint32Array([nx, ny, nz]));
  frame.box = Box.cube(10.0, new Float64Array([0, 0, 0]), false, false, false);
  const atoms = frame.createBlock("atoms");
  atoms.setColF("x", new Float64Array([0]));
  atoms.setColF("y", new Float64Array([0]));
  atoms.setColF("z", new Float64Array([0]));
  atoms.setColStr("element", ["C"]);
  return frame;
}

describe("DrawIsosurfaceModifier.matches", () => {
  it("returns true for a frame with a 3-D grid block and simbox", () => {
    expect(
      new DrawIsosurfaceModifier().matches(syntheticGridFrame(8, 8, 8)),
    ).toBe(true);
  });

  it("returns false for an atoms-only frame", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.setColF("x", new Float64Array([0]));
    atoms.setColF("y", new Float64Array([0]));
    atoms.setColF("z", new Float64Array([0]));
    atoms.setColStr("element", ["C"]);
    expect(new DrawIsosurfaceModifier().matches(frame)).toBe(false);
  });

  it("returns false when grid has no simbox", () => {
    const frame = new Frame();
    const grid = frame.createBlock("grid");
    grid.setColF("density", new Float64Array(8));
    grid.setShape(new Uint32Array([2, 2, 2]));
    expect(new DrawIsosurfaceModifier().matches(frame)).toBe(false);
  });
});

describe("DrawIsosurfaceModifier.availableChannels", () => {
  it("lists every grid column for the channel selector", () => {
    const frame = new Frame();
    const grid = frame.createBlock("grid");
    grid.setColF("total", new Float64Array(8));
    grid.setColF("diff", new Float64Array(8));
    grid.setShape(new Uint32Array([2, 2, 2]));
    expect(DrawIsosurfaceModifier.availableChannels(frame).sort()).toEqual([
      "diff",
      "total",
    ]);
  });

  it("returns empty when frame has no grid block", () => {
    expect(DrawIsosurfaceModifier.availableChannels(new Frame())).toEqual([]);
  });
});
