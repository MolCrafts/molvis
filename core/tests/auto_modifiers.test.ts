import { Box, Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import { applyAutoAttach } from "../src/pipeline/auto_attach";
import { DrawRibbonModifier } from "../src/pipeline/draw_ribbon";
import { ModifierPipeline } from "../src/pipeline/pipeline";
import { type PipelineContext, SelectionMask } from "../src/pipeline/types";

/** Minimal `PipelineContext` for unit tests. The merged
 *  `DrawRibbonModifier.apply` invokes `ctx.app.artist.drawRibbon` as
 *  its render side-effect — we stub that out so tests can focus on
 *  the data-transformation contract (the residues block). */
function testContext(): PipelineContext {
  const stubApp = {
    artist: { drawRibbon: () => {} },
  } as unknown as PipelineContext["app"];
  return {
    selectionSet: new Map(),
    currentSelection: SelectionMask.all(0),
    selectedBondIds: [],
    suppressHighlight: false,
    postRenderEffects: [],
    selectionCache: new Map(),
    app: stubApp,
    changeKind: "full",
  };
}

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

describe("DrawRibbonModifier.matches", () => {
  it("returns false when there is no atoms block", () => {
    const frame = new Frame();
    expect(new DrawRibbonModifier().matches(frame)).toBe(false);
  });

  it("returns false for an atoms block lacking residue columns (XYZ-shape)", () => {
    expect(new DrawRibbonModifier().matches(xyzShapedFrame())).toBe(false);
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
    expect(new DrawRibbonModifier().matches(frame)).toBe(true);
  });

  it("returns false when res_seq has the wrong dtype (string instead of i32)", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.setColF("x", new Float64Array([0]));
    atoms.setColStr("name", ["CA"]);
    atoms.setColStr("res_name", ["ALA"]);
    atoms.setColStr("res_seq", ["1"]); // wrong dtype
    atoms.setColStr("chain_id", ["A"]);
    expect(new DrawRibbonModifier().matches(frame)).toBe(false);
  });
});

describe("DrawRibbonModifier.apply", () => {
  it("writes a residues block with one row per residue with a CA", () => {
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
    const out = new DrawRibbonModifier().apply(frame, ctx);
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
    const out = new DrawRibbonModifier().apply(frame, ctx);
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
    const out = new DrawRibbonModifier().apply(frame, ctx);
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
    const out = new DrawRibbonModifier().apply(frame, ctx);
    const residues = out.getBlock("residues");
    expect(residues).toBeDefined();
    if (!residues) return;
    expect(residues.nrows()).toBe(1);
    expect(residues.copyColF("ca_x")[0]).toBe(0);
    expect(Number.isNaN(residues.copyColF("o_x")[0])).toBe(true);
  });

  it("splits a chain when consecutive CAs cross a periodic boundary", () => {
    // 50 Å cubic box. Three CAs: 0, 4, 34. Pair 1→2 is a normal step
    // (Δx=4 — agrees with minimum-image). Pair 2→3 has Δx=30 > 25
    // (half cell), so the minimum-image displacement is -20 (going
    // the other way around) — disagrees with raw → PBC jump → split.
    const frame = pdbShapedFrame(
      { x: [0, 4, 34], y: [0, 0, 0], z: [0, 0, 0] },
      {
        name: ["CA", "CA", "CA"],
        res_name: ["ALA", "GLY", "VAL"],
        res_seq: [1, 2, 3],
        chain_id: ["A", "A", "A"],
      },
    );
    frame.simbox = Box.cube(50, new Float64Array([0, 0, 0]), true, true, true);
    const ctx = testContext();
    const out = new DrawRibbonModifier().apply(frame, ctx);
    const residues = out.getBlock("residues");
    expect(residues).toBeDefined();
    if (!residues) return;
    const chains = residues.copyColStr("chain_id") as string[];
    expect(chains).toEqual(["A", "A", "A__brk1"]);
  });

  it("does not break a chain when raw == minimum-image (everything fits)", () => {
    // 50 Å box, four CAs at normal 3.8 Å spacing. None of the
    // displacements approach half-cell, so the minimum-image
    // convention returns the trivial vector for every pair → no split.
    const frame = pdbShapedFrame(
      { x: [0, 3.8, 7.6, 11.4], y: [0, 0, 0, 0], z: [0, 0, 0, 0] },
      {
        name: ["CA", "CA", "CA", "CA"],
        res_name: ["ALA", "GLY", "VAL", "LEU"],
        res_seq: [1, 2, 3, 4],
        chain_id: ["A", "A", "A", "A"],
      },
    );
    frame.simbox = Box.cube(50, new Float64Array([0, 0, 0]), true, true, true);
    const ctx = testContext();
    const out = new DrawRibbonModifier().apply(frame, ctx);
    const residues = out.getBlock("residues");
    expect(residues).toBeDefined();
    if (!residues) return;
    const chains = residues.copyColStr("chain_id") as string[];
    expect(chains.every((c) => c === "A")).toBe(true);
  });

  it("splits a chain at a large CA–CA gap even without a simbox", () => {
    // Without a box the PBC check is skipped, but a 30 Å step between
    // consecutive CAs is still a chain break (real peptide bonds put
    // CA[i+1] within ~3.8 Å). The gap detector must catch this so the
    // ribbon doesn't fit a smooth spline across a missing-residue
    // region.
    const frame = pdbShapedFrame(
      { x: [0, 4, 34], y: [0, 0, 0], z: [0, 0, 0] },
      {
        name: ["CA", "CA", "CA"],
        res_name: ["ALA", "GLY", "VAL"],
        res_seq: [1, 2, 3],
        chain_id: ["A", "A", "A"],
      },
    );
    const ctx = testContext();
    const out = new DrawRibbonModifier().apply(frame, ctx);
    const residues = out.getBlock("residues");
    expect(residues).toBeDefined();
    if (!residues) return;
    const chains = residues.copyColStr("chain_id") as string[];
    expect(chains).toEqual(["A", "A", "A__brk1"]);
  });

  it("does not split at normal peptide-bond CA–CA spacing without a simbox", () => {
    // 3.8 Å CA spacing — a real peptide bond — must never break the
    // chain. Guards against an over-aggressive gap threshold that
    // would slice every coil into singletons.
    const frame = pdbShapedFrame(
      { x: [0, 3.8, 7.6, 11.4], y: [0, 0, 0, 0], z: [0, 0, 0, 0] },
      {
        name: ["CA", "CA", "CA", "CA"],
        res_name: ["ALA", "GLY", "VAL", "LEU"],
        res_seq: [1, 2, 3, 4],
        chain_id: ["A", "A", "A", "A"],
      },
    );
    const ctx = testContext();
    const out = new DrawRibbonModifier().apply(frame, ctx);
    const residues = out.getBlock("residues");
    expect(residues).toBeDefined();
    if (!residues) return;
    const chains = residues.copyColStr("chain_id") as string[];
    expect(chains.every((c) => c === "A")).toBe(true);
  });
});

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
    expect(ids).toContain("Draw Ribbon");
    expect(pipelineSize(pipeline)).toBeGreaterThan(before);
  });

  it("does NOT attach BackboneRibbon to a non-PDB frame", () => {
    const pipeline = new ModifierPipeline();
    const ids = applyAutoAttach(pipeline, xyzShapedFrame());
    expect(ids).not.toContain("Draw Ribbon");
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
    const ids = applyAutoAttach(pipeline, frame, new Set(["Draw Ribbon"]));
    expect(ids).not.toContain("Draw Ribbon");
  });
});

function pipelineSize(pipeline: ModifierPipeline): number {
  return (pipeline as unknown as { modifiers: unknown[] }).modifiers.length;
}
