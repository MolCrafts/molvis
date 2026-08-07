import { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { applyAutoAttach } from "../../src/pipeline/auto_attach";
import { DrawIsosurfaceModifier } from "../../src/pipeline/draw_isosurface";
import { ModifierPipeline } from "../../src/pipeline/pipeline";

/** Build a frame whose atoms block carries the four PDB residue-identity
 *  columns the BackboneRibbon predicate keys on. */
function pdbShapedFrame(
  positions: { x: number[]; y: number[]; z: number[] },
  cols: {
    name: string[];
    res_name: string[];
    res_seq: number[];
    chain_id: string[];
  },
): Frame {
  const frame = new Frame();
  const n = positions.x.length;
  const atoms = frame.createBlock("atoms");
  atoms.setColF("x", new Float64Array(positions.x));
  atoms.setColF("y", new Float64Array(positions.y));
  atoms.setColF("z", new Float64Array(positions.z));
  atoms.setColStr("name", cols.name);
  atoms.setColStr("res_name", cols.res_name);
  atoms.setColI32("res_seq", new Int32Array(cols.res_seq));
  atoms.setColStr("chain_id", cols.chain_id);
  if (n === 0) throw new Error("test fixture must have at least one atom");
  return frame;
}

/** Plain XYZ-shape frame — element + xyz, no residue columns. */
function xyzShapedFrame(): Frame {
  const frame = new Frame();
  const atoms = frame.createBlock("atoms");
  atoms.setColF("x", new Float64Array([0]));
  atoms.setColF("y", new Float64Array([0]));
  atoms.setColF("z", new Float64Array([0]));
  atoms.setColStr("element", ["C"]);
  return frame;
}

describe("applyAutoAttach", () => {
  it("attaches BackboneRibbon to a PDB-shape frame and returns its name", () => {
    const pipeline = new ModifierPipeline();
    const before = pipelineSize(pipeline);
    const frame = pdbShapedFrame(
      { x: [1, 2], y: [0, 0], z: [0, 0] },
      {
        name: ["CA", "O"],
        res_name: ["ALA", "ALA"],
        res_seq: [1, 1],
        chain_id: ["A", "A"],
      },
    );
    const ids = applyAutoAttach(pipeline, frame);
    expect(ids).toContain("Ribbon");
    expect(pipelineSize(pipeline)).toBeGreaterThan(before);
  });

  it("does NOT attach BackboneRibbon to a non-PDB frame", () => {
    const pipeline = new ModifierPipeline();
    const ids = applyAutoAttach(pipeline, xyzShapedFrame());
    expect(ids).not.toContain("Ribbon");
  });

  it("respects the suppressed-id set so removed modifiers don't re-attach", () => {
    const pipeline = new ModifierPipeline();
    const frame = pdbShapedFrame(
      { x: [1], y: [0], z: [0] },
      {
        name: ["CA"],
        res_name: ["ALA"],
        res_seq: [1],
        chain_id: ["A"],
      },
    );
    const ids = applyAutoAttach(pipeline, frame, new Set(["Ribbon"]));
    expect(ids).not.toContain("Ribbon");
  });

  it("is idempotent: a second call does not stack another Particles layer", () => {
    const pipeline = new ModifierPipeline();
    const frame = xyzShapedFrame();
    const first = applyAutoAttach(pipeline, frame);
    expect(first).toContain("Particles");
    const sizeAfterFirst = pipelineSize(pipeline);
    const second = applyAutoAttach(pipeline, frame);
    expect(second).not.toContain("Particles");
    expect(pipelineSize(pipeline)).toBe(sizeAfterFirst);
  });
});

function pipelineSize(pipeline: ModifierPipeline): number {
  return pipeline.getEntries().length;
}

function syntheticGridFrame(): Frame {
  const frame = new Frame();
  const grid = frame.createBlock("grid");
  grid.setColF("density", new Float64Array(8 * 8 * 8));
  grid.setShape(new Uint32Array([8, 8, 8]));
  frame.box = Box.cube(
    new Float64Array([10.0]),
    new Float64Array([0, 0, 0]),
    false,
    false,
    false,
  );
  const atoms = frame.createBlock("atoms");
  atoms.setColF("x", new Float64Array([0]));
  atoms.setColF("y", new Float64Array([0]));
  atoms.setColF("z", new Float64Array([0]));
  atoms.setColStr("element", ["C"]);
  return frame;
}

describe("applyAutoAttach isosurface", () => {
  it("attaches Create isosurface for grid-bearing frames", () => {
    const pipeline = new ModifierPipeline();
    const attached = applyAutoAttach(pipeline, syntheticGridFrame());
    expect(attached).toContain(DrawIsosurfaceModifier.NAME);
  });

  it("does not attach Create isosurface for atoms-only frames", () => {
    const pipeline = new ModifierPipeline();
    const attached = applyAutoAttach(pipeline, xyzShapedFrame());
    expect(attached).not.toContain(DrawIsosurfaceModifier.NAME);
  });
});
