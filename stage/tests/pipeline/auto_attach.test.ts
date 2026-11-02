import { toDomainUint } from "@molcrafts/molvis-core";
import { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { applyAutoAttach } from "../../src/pipeline/auto_attach";
import { IsosurfaceModifier } from "../../src/pipeline/isosurface";
import { ModifierPipeline } from "../../src/pipeline/pipeline";

/** Build a frame whose atoms block carries the four PDB residue-identity
 *  columns the BackboneRibbon predicate keys on. */
function pdbShapedFrame(
  positions: { x: number[]; y: number[]; z: number[] },
  cols: {
    name: string[];
    res_name: string[];
    res_id: number[];
    chain: string[];
  },
): Frame {
  const frame = new Frame();
  const n = positions.x.length;
  const atoms = frame.createBlock("atoms");
  atoms.set("x", new Float64Array(positions.x));
  atoms.set("y", new Float64Array(positions.y));
  atoms.set("z", new Float64Array(positions.z));
  atoms.set("name", cols.name);
  atoms.set("res_name", cols.res_name);
  atoms.set("res_id", toDomainUint(cols.res_id));
  atoms.set("chain", cols.chain);
  if (n === 0) throw new Error("test fixture must have at least one atom");
  return frame;
}

/** Plain XYZ-shape frame — element + xyz, no residue columns. */
function xyzShapedFrame(): Frame {
  const frame = new Frame();
  const atoms = frame.createBlock("atoms");
  atoms.set("x", new Float64Array([0]));
  atoms.set("y", new Float64Array([0]));
  atoms.set("z", new Float64Array([0]));
  atoms.set("element", ["C"]);
  return frame;
}

describe("applyAutoAttach", () => {
  it("attaches Cartoon to a PDB-shape frame and returns its name", () => {
    const pipeline = new ModifierPipeline();
    const before = pipelineSize(pipeline);
    const frame = pdbShapedFrame(
      { x: [1, 2], y: [0, 0], z: [0, 0] },
      {
        name: ["CA", "O"],
        res_name: ["ALA", "ALA"],
        res_id: [1, 1],
        chain: ["A", "A"],
      },
    );
    const ids = applyAutoAttach(pipeline, frame);
    expect(ids).toContain("Cartoon");
    expect(pipelineSize(pipeline)).toBeGreaterThan(before);
  });

  it("does NOT attach Cartoon to a non-PDB frame", () => {
    const pipeline = new ModifierPipeline();
    const ids = applyAutoAttach(pipeline, xyzShapedFrame());
    expect(ids).not.toContain("Cartoon");
  });

  it("respects the suppressed-id set so removed modifiers don't re-attach", () => {
    const pipeline = new ModifierPipeline();
    const frame = pdbShapedFrame(
      { x: [1], y: [0], z: [0] },
      {
        name: ["CA"],
        res_name: ["ALA"],
        res_id: [1],
        chain: ["A"],
      },
    );
    const ids = applyAutoAttach(pipeline, frame, new Set(["Cartoon"]));
    expect(ids).not.toContain("Cartoon");
  });

  it("does not auto-attach Create bonds on a bondless XYZ-shape frame", () => {
    const pipeline = new ModifierPipeline();
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.set("x", new Float64Array([0, 1.2]));
    atoms.set("y", new Float64Array([0, 0]));
    atoms.set("z", new Float64Array([0, 0]));
    atoms.set("element", ["C", "O"]);
    const ids = applyAutoAttach(pipeline, frame);
    expect(ids).not.toContain("Create bonds");
    expect(ids).not.toContain("Bonds");
    expect(ids).toContain("Particles");
  });

  it("attaches Bonds when the frame already has drawable bonds", () => {
    const pipeline = new ModifierPipeline();
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.set("x", new Float64Array([0, 1.2]));
    atoms.set("y", new Float64Array([0, 0]));
    atoms.set("z", new Float64Array([0, 0]));
    atoms.set("element", ["C", "O"]);
    const bonds = frame.createBlock("bonds");
    bonds.set("atomi", new BigUint64Array([0n]));
    bonds.set("atomj", new BigUint64Array([1n]));
    const ids = applyAutoAttach(pipeline, frame);
    expect(ids).not.toContain("Create bonds");
    expect(ids).toContain("Bonds");
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
  grid.set("density", new Float64Array(8 * 8 * 8));
  grid.setShape([8, 8, 8]);
  frame.box = Box.cube(10.0, new Float64Array([0, 0, 0]), false, false, false);
  const atoms = frame.createBlock("atoms");
  atoms.set("x", new Float64Array([0]));
  atoms.set("y", new Float64Array([0]));
  atoms.set("z", new Float64Array([0]));
  atoms.set("element", ["C"]);
  return frame;
}

describe("applyAutoAttach isosurface", () => {
  it("attaches Isosurface for grid-bearing frames", () => {
    const pipeline = new ModifierPipeline();
    const attached = applyAutoAttach(pipeline, syntheticGridFrame());
    expect(attached).toContain(IsosurfaceModifier.NAME);
  });

  it("does not attach Isosurface for atoms-only frames", () => {
    const pipeline = new ModifierPipeline();
    const attached = applyAutoAttach(pipeline, xyzShapedFrame());
    expect(attached).not.toContain(IsosurfaceModifier.NAME);
  });
});
