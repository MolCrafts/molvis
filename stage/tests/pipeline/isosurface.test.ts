/**
 * IsosurfaceModifier tests.
 *
 * It is a geometry *producer* now: it publishes triangles into
 * `context.surfaces` and never touches the artist. These cover the gating and
 * channel selection; the meshing itself is `algo/marching_cubes`' business.
 */

import { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  gridChannels,
  hasMeshableGrid,
} from "../../src/algo/surface/grid_field";
import { DrawSurfaceModifier } from "../../src/pipeline/draw_surface";
import { IsosurfaceModifier } from "../../src/pipeline/isosurface";
import { ModifierCapability } from "../../src/pipeline/modifier";

/** Synthetic grid + simbox for match/channel unit tests. */
function syntheticGridFrame(nx: number, ny: number, nz: number): Frame {
  const frame = new Frame();
  const grid = frame.createBlock("grid");
  grid.set("density", new Float64Array(nx * ny * nz));
  grid.setShape([nx, ny, nz]);
  frame.box = Box.cube(10.0, new Float64Array([0, 0, 0]), false, false, false);
  const atoms = frame.createBlock("atoms");
  atoms.set("x", new Float64Array([0]));
  atoms.set("y", new Float64Array([0]));
  atoms.set("z", new Float64Array([0]));
  atoms.set("element", ["C"]);
  return frame;
}

describe("IsosurfaceModifier", () => {
  it("produces geometry rather than drawing it", () => {
    const mod = new IsosurfaceModifier();
    expect(mod.capabilities.has(ModifierCapability.ProducesGeometry)).toBe(
      true,
    );
    expect(mod.capabilities.has(ModifierCapability.Draws)).toBe(false);
  });

  it("brings a Draw surface bound to itself", () => {
    const mod = new IsosurfaceModifier("iso-1");
    const draw = mod.createDraw();
    expect(draw).toBeInstanceOf(DrawSurfaceModifier);
    expect(draw.producerId).toBe("iso-1");
  });

  it("auto-attaches for a frame with a 3-D grid and a box", () => {
    const frame = syntheticGridFrame(8, 8, 8);
    expect(new IsosurfaceModifier().matches(frame)).toBe(true);
    frame.free();
  });

  it("does not auto-attach for an atoms-only frame", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.set("x", new Float64Array([0]));
    atoms.set("y", new Float64Array([0]));
    atoms.set("z", new Float64Array([0]));
    expect(new IsosurfaceModifier().matches(frame)).toBe(false);
    frame.free();
  });

  it("does not auto-attach when the grid has no box to sit in", () => {
    // Voxels without a box have no world position; there is nothing to place.
    const frame = new Frame();
    const grid = frame.createBlock("grid");
    grid.set("density", new Float64Array(8));
    grid.setShape([2, 2, 2]);
    expect(new IsosurfaceModifier().matches(frame)).toBe(false);
    frame.free();
  });

  it("rejects a grid too small for a single marching-cubes cell", () => {
    const frame = new Frame();
    const grid = frame.createBlock("grid");
    grid.set("density", new Float64Array(2));
    grid.setShape([1, 1, 2]);
    frame.box = Box.cube(10, new Float64Array([0, 0, 0]), false, false, false);
    expect(hasMeshableGrid(frame)).toBe(false);
    frame.free();
  });

  it("changing channel drops the isovalue with it", () => {
    // A new channel's data range has nothing to do with the old one's, so a
    // carried-over isovalue would usually mesh nothing at all.
    const mod = new IsosurfaceModifier();
    mod.setChannel("total");
    mod.setIsovalue(0.05);
    expect(mod.isovalue).toBe(0.05);
    mod.setChannel("diff");
    expect(mod.isovalue).toBeNull();
  });

  it("re-setting the same channel keeps the isovalue", () => {
    const mod = new IsosurfaceModifier();
    mod.setChannel("total");
    mod.setIsovalue(0.05);
    mod.setChannel("total");
    expect(mod.isovalue).toBe(0.05);
  });
});

describe("gridChannels", () => {
  it("lists every grid column for the channel selector", () => {
    const frame = new Frame();
    const grid = frame.createBlock("grid");
    grid.set("total", new Float64Array(8));
    grid.set("diff", new Float64Array(8));
    grid.setShape([2, 2, 2]);
    expect(gridChannels(frame).sort()).toEqual(["diff", "total"]);
    frame.free();
  });

  it("is empty when the frame has no grid block", () => {
    const frame = new Frame();
    expect(gridChannels(frame)).toEqual([]);
    frame.free();
  });
});
