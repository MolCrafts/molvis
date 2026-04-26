import { Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  type AutoAttachableModifier,
  BackboneRibbonModifier,
  applyAutoAttach,
} from "../src/pipeline/auto_modifiers";
import { ModifierPipeline } from "../src/pipeline/pipeline";
import { type PipelineContext, SelectionMask } from "../src/pipeline/types";

/** Minimal `PipelineContext` for unit tests. `BackboneRibbonModifier.apply`
 *  doesn't read context, so we don't need a real `MolvisApp`. */
function testContext(): PipelineContext {
  return {
    selectionSet: new Map(),
    currentSelection: SelectionMask.all(0),
    selectedBondIds: [],
    suppressHighlight: false,
    postRenderEffects: [],
    selectionCache: new Map(),
    app: undefined as unknown as PipelineContext["app"],
  };
}

/** Build a frame whose atoms block carries the four PDB residue-identity
 *  columns the BackboneRibbon predicate keys on. The provided arrays
 *  must all have the same length. */
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

describe("BackboneRibbonModifier.matches", () => {
  it("returns false when there is no atoms block", () => {
    const frame = new Frame();
    expect(BackboneRibbonModifier.matches(frame)).toBe(false);
  });

  it("returns false for an atoms block lacking residue columns (XYZ-shape)", () => {
    expect(BackboneRibbonModifier.matches(xyzShapedFrame())).toBe(false);
  });

  it("returns true for an atoms block with name/res_name/res_seq/chain_id", () => {
    const frame = pdbShapedFrame(
      { x: [1, 2, 3, 4], y: [0, 0, 0, 0], z: [0, 0, 0, 0] },
      {
        name: ["N", "CA", "C", "O"],
        res_name: ["ALA", "ALA", "ALA", "ALA"],
        res_seq: [1, 1, 1, 1],
        chain_id: ["A", "A", "A", "A"],
      },
    );
    expect(BackboneRibbonModifier.matches(frame)).toBe(true);
  });

  it("returns false when res_seq has the wrong dtype (string instead of i32)", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.setColF("x", new Float64Array([0]));
    atoms.setColStr("name", ["CA"]);
    atoms.setColStr("res_name", ["ALA"]);
    atoms.setColStr("res_seq", ["1"]); // wrong dtype
    atoms.setColStr("chain_id", ["A"]);
    expect(BackboneRibbonModifier.matches(frame)).toBe(false);
  });
});

describe("BackboneRibbonModifier.apply", () => {
  it("writes a residues block with one row per residue with a CA", () => {
    // Two residues in chain A, one in chain B. Each has CA + O.
    const frame = pdbShapedFrame(
      {
        x: [0, 1, 0, 2, 0, 5, 0, 6, 0, 10, 0, 11],
        y: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        z: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      {
        name: ["N", "CA", "C", "O", "N", "CA", "C", "O", "N", "CA", "C", "O"],
        res_name: [
          "ALA",
          "ALA",
          "ALA",
          "ALA",
          "GLY",
          "GLY",
          "GLY",
          "GLY",
          "VAL",
          "VAL",
          "VAL",
          "VAL",
        ],
        res_seq: [1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1],
        chain_id: ["A", "A", "A", "A", "A", "A", "A", "A", "B", "B", "B", "B"],
      },
    );
    const ctx = testContext();
    const out = new BackboneRibbonModifier().apply(frame, ctx);
    const residues = out.getBlock("residues");
    expect(residues).toBeDefined();
    if (!residues) return;
    expect(residues.nrows()).toBe(3);

    const chains = residues.copyColStr("chain_id") as string[];
    const seqs = residues.copyColU32("res_seq");
    const resNames = residues.copyColStr("res_name") as string[];
    const caX = residues.copyColF("ca_x");
    const oX = residues.copyColF("o_x");
    const ss = residues.copyColStr("ss") as string[];

    // Sorted by chain then res_seq: (A,1), (A,2), (B,1)
    expect(chains).toEqual(["A", "A", "B"]);
    expect(Array.from(seqs)).toEqual([1, 2, 1]);
    expect(resNames).toEqual(["ALA", "GLY", "VAL"]);
    expect(caX[0]).toBe(1);
    expect(caX[1]).toBe(5);
    expect(caX[2]).toBe(10);
    expect(oX[0]).toBe(2);
    expect(oX[1]).toBe(6);
    expect(oX[2]).toBe(11);
    expect(ss).toEqual(["coil", "coil", "coil"]);
  });

  it("drops residues that lack a CA atom", () => {
    const frame = pdbShapedFrame(
      { x: [0, 1], y: [0, 0], z: [0, 0] },
      {
        name: ["N", "O"],
        res_name: ["ALA", "ALA"],
        res_seq: [1, 1],
        chain_id: ["A", "A"],
      },
    );
    const ctx = testContext();
    const out = new BackboneRibbonModifier().apply(frame, ctx);
    expect(out.getBlock("residues")).toBeUndefined();
  });

  it("encodes a missing O as NaN in o_x/o_y/o_z so the renderer can detect", () => {
    const frame = pdbShapedFrame(
      { x: [0, 1], y: [0, 0], z: [0, 0] },
      {
        name: ["N", "CA"],
        res_name: ["ALA", "ALA"],
        res_seq: [1, 1],
        chain_id: ["A", "A"],
      },
    );
    const ctx = testContext();
    const out = new BackboneRibbonModifier().apply(frame, ctx);
    const residues = out.getBlock("residues");
    expect(residues).toBeDefined();
    if (!residues) return;
    expect(Number.isNaN(residues.copyColF("o_x")[0])).toBe(true);
    expect(Number.isNaN(residues.copyColF("o_y")[0])).toBe(true);
    expect(Number.isNaN(residues.copyColF("o_z")[0])).toBe(true);
  });

  it("ignores non-backbone atom names (CB, side-chain, hydrogens, …)", () => {
    const frame = pdbShapedFrame(
      { x: [0, 1, 5], y: [0, 0, 0], z: [0, 0, 0] },
      {
        name: ["CA", "CB", "HD1"],
        res_name: ["ALA", "ALA", "ALA"],
        res_seq: [1, 1, 1],
        chain_id: ["A", "A", "A"],
      },
    );
    const ctx = testContext();
    const out = new BackboneRibbonModifier().apply(frame, ctx);
    const residues = out.getBlock("residues");
    expect(residues).toBeDefined();
    if (!residues) return;
    expect(residues.nrows()).toBe(1);
    expect(residues.copyColF("ca_x")[0]).toBe(0);
    expect(Number.isNaN(residues.copyColF("o_x")[0])).toBe(true);
  });
});

describe("applyAutoAttach", () => {
  it("attaches BackboneRibbon to a PDB-shape frame and returns its id", () => {
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
    expect(ids).toContain("backbone-ribbon");
    expect(pipelineSize(pipeline)).toBe(before + 1);
  });

  it("does NOT attach BackboneRibbon to a non-PDB frame", () => {
    const pipeline = new ModifierPipeline();
    const before = pipelineSize(pipeline);
    const ids = applyAutoAttach(pipeline, xyzShapedFrame());
    expect(ids).toEqual([]);
    expect(pipelineSize(pipeline)).toBe(before);
  });

  it("respects the suppressed-id set so removed modifiers don't re-attach", () => {
    const pipeline = new ModifierPipeline();
    const before = pipelineSize(pipeline);
    const frame = pdbShapedFrame(
      { x: [1], y: [0], z: [0] },
      {
        name: ["CA"],
        res_name: ["ALA"],
        res_seq: [1],
        chain_id: ["A"],
      },
    );
    const ids = applyAutoAttach(pipeline, frame, new Set(["backbone-ribbon"]));
    expect(ids).toEqual([]);
    expect(pipelineSize(pipeline)).toBe(before);
  });
});

/** Compile-time check: BackboneRibbonModifier satisfies the
 *  AutoAttachableModifier class-side contract (constructor + statics). */
const _typecheck: AutoAttachableModifier = BackboneRibbonModifier;
void _typecheck;

function pipelineSize(pipeline: ModifierPipeline): number {
  return (pipeline as unknown as { modifiers: unknown[] }).modifiers.length;
}
