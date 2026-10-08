import { toDomainUint } from "@molcrafts/molvis-core";
import { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { DrawRibbonModifier } from "../../src/pipeline/draw_ribbon";
import { type PipelineContext, SelectionMask } from "../../src/pipeline/types";

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
    surfaces: new Map(),
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

describe("DrawRibbonModifier.matches", () => {
  it("returns false when there is no atoms block", () => {
    const frame = new Frame();
    expect(new DrawRibbonModifier().matches(frame)).toBe(false);
  });

  it("returns false for an atoms block lacking residue columns (XYZ-shape)", () => {
    expect(new DrawRibbonModifier().matches(xyzShapedFrame())).toBe(false);
  });

  it("returns true for an atoms block with name/res_name/res_id/chain", () => {
    const frame = pdbShapedFrame(
      { x: [1, 2, 3, 4], y: [0, 0, 0, 0], z: [0, 0, 0, 0] },
      {
        name: ["N", "CA", "C", "O"],
        res_name: ["ALA", "ALA", "ALA", "ALA"],
        res_id: [1, 1, 1, 1],
        chain: ["A", "A", "A", "A"],
      },
    );
    expect(new DrawRibbonModifier().matches(frame)).toBe(true);
  });

  it("returns false when the atoms block has no res_id", () => {
    const frame = new Frame();
    const atoms = frame.createBlock("atoms");
    atoms.set("x", new Float64Array([0]));
    atoms.set("name", ["CA"]);
    atoms.set("res_name", ["ALA"]);
    atoms.set("chain", ["A"]);
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
        res_id: [1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1],
        chain: ["A", "A", "A", "A", "A", "A", "A", "A", "B", "B", "B", "B"],
      },
    );
    const ctx = testContext();
    const out = new DrawRibbonModifier().apply(frame, ctx);
    const residues = out.has("residues") ? out.get("residues") : undefined;
    expect(residues).toBeDefined();
    if (!residues) return;
    expect(residues.nRows).toBe(3);

    const chains = residues.copy("chain_id") as string[];
    const seqs = residues.copy("res_seq") as Int32Array;
    const resNames = residues.copy("res_name") as string[];
    const caX = residues.copy("ca_x") as Float64Array;
    const oX = residues.copy("o_x") as Float64Array;
    const ss = residues.copy("ss") as string[];

    expect([...chains]).toEqual(["A", "A", "B"]);
    expect(Array.from(seqs)).toEqual([1, 2, 1]);
    expect([...resNames]).toEqual(["ALA", "GLY", "VAL"]);
    expect(caX[0]).toBe(1);
    expect(caX[1]).toBe(5);
    expect(caX[2]).toBe(10);
    expect(oX[0]).toBe(2);
    expect(oX[1]).toBe(6);
    expect(oX[2]).toBe(11);
    expect([...ss]).toEqual(["coil", "coil", "coil"]);
  });

  it("drops residues that lack a CA atom", () => {
    const frame = pdbShapedFrame(
      { x: [0, 1], y: [0, 0], z: [0, 0] },
      {
        name: ["N", "O"],
        res_name: ["ALA", "ALA"],
        res_id: [1, 1],
        chain: ["A", "A"],
      },
    );
    const ctx = testContext();
    const out = new DrawRibbonModifier().apply(frame, ctx);
    expect(out.has("residues")).toBe(false);
  });

  it("encodes a missing O as NaN in o_x/o_y/o_z so the renderer can detect", () => {
    const frame = pdbShapedFrame(
      { x: [0, 1], y: [0, 0], z: [0, 0] },
      {
        name: ["N", "CA"],
        res_name: ["ALA", "ALA"],
        res_id: [1, 1],
        chain: ["A", "A"],
      },
    );
    const ctx = testContext();
    const out = new DrawRibbonModifier().apply(frame, ctx);
    const residues = out.has("residues") ? out.get("residues") : undefined;
    expect(residues).toBeDefined();
    if (!residues) return;
    expect(Number.isNaN((residues.copy("o_x") as Float64Array)[0])).toBe(true);
    expect(Number.isNaN((residues.copy("o_y") as Float64Array)[0])).toBe(true);
    expect(Number.isNaN((residues.copy("o_z") as Float64Array)[0])).toBe(true);
  });

  it("ignores non-backbone atom names (CB, side-chain, hydrogens, …)", () => {
    const frame = pdbShapedFrame(
      { x: [0, 1, 5], y: [0, 0, 0], z: [0, 0, 0] },
      {
        name: ["CA", "CB", "HD1"],
        res_name: ["ALA", "ALA", "ALA"],
        res_id: [1, 1, 1],
        chain: ["A", "A", "A"],
      },
    );
    const ctx = testContext();
    const out = new DrawRibbonModifier().apply(frame, ctx);
    const residues = out.has("residues") ? out.get("residues") : undefined;
    expect(residues).toBeDefined();
    if (!residues) return;
    expect(residues.nRows).toBe(1);
    expect((residues.copy("ca_x") as Float64Array)[0]).toBe(0);
    expect(Number.isNaN((residues.copy("o_x") as Float64Array)[0])).toBe(true);
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
        res_id: [1, 2, 3],
        chain: ["A", "A", "A"],
      },
    );
    frame.box = Box.cube(50, new Float64Array([0, 0, 0]), true, true, true);
    const ctx = testContext();
    const out = new DrawRibbonModifier().apply(frame, ctx);
    const residues = out.has("residues") ? out.get("residues") : undefined;
    expect(residues).toBeDefined();
    if (!residues) return;
    const chains = residues.copy("chain_id") as string[];
    expect([...chains]).toEqual(["A", "A", "A__brk1"]);
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
        res_id: [1, 2, 3, 4],
        chain: ["A", "A", "A", "A"],
      },
    );
    frame.box = Box.cube(50, new Float64Array([0, 0, 0]), true, true, true);
    const ctx = testContext();
    const out = new DrawRibbonModifier().apply(frame, ctx);
    const residues = out.has("residues") ? out.get("residues") : undefined;
    expect(residues).toBeDefined();
    if (!residues) return;
    const chains = residues.copy("chain_id") as string[];
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
        res_id: [1, 2, 3],
        chain: ["A", "A", "A"],
      },
    );
    const ctx = testContext();
    const out = new DrawRibbonModifier().apply(frame, ctx);
    const residues = out.has("residues") ? out.get("residues") : undefined;
    expect(residues).toBeDefined();
    if (!residues) return;
    const chains = residues.copy("chain_id") as string[];
    expect([...chains]).toEqual(["A", "A", "A__brk1"]);
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
        res_id: [1, 2, 3, 4],
        chain: ["A", "A", "A", "A"],
      },
    );
    const ctx = testContext();
    const out = new DrawRibbonModifier().apply(frame, ctx);
    const residues = out.has("residues") ? out.get("residues") : undefined;
    expect(residues).toBeDefined();
    if (!residues) return;
    const chains = residues.copy("chain_id") as string[];
    expect(chains.every((c) => c === "A")).toBe(true);
  });
});

describe("DrawRibbonModifier product name and SS colors", () => {
  it("is named Cartoon", () => {
    expect(DrawRibbonModifier.NAME).toBe("Cartoon");
    expect(new DrawRibbonModifier().name).toBe("Cartoon");
  });

  it("defaults SS colors to PyMOL-like hex and includes them in the cache key", () => {
    const mod = new DrawRibbonModifier();
    expect([...mod.helixColor]).toEqual([229 / 255, 83 / 255, 61 / 255]);
    expect([...mod.sheetColor]).toEqual([240 / 255, 196 / 255, 25 / 255]);
    expect([...mod.coilColor]).toEqual([125 / 255, 206 / 255, 122 / 255]);
    const key = mod.getCacheKey();
    expect(key).toContain("hx=#E5533D");
    expect(key).toContain("sx=#F0C419");
    expect(key).toContain("cx=#7DCE7A");
    mod.setHelixColor("#112233");
    expect(mod.getCacheKey()).not.toBe(key);
    expect(mod.getCacheKey()).toContain("hx=#112233");
  });

  it("accepts display RGB and rejects bad hex", () => {
    const mod = new DrawRibbonModifier();
    mod.setSheetColor([0, 1, 0]);
    expect([...mod.sheetColor]).toEqual([0, 1, 0]);
    expect(() => mod.setHelixColor("not-a-color")).toThrow(/not-a-color/);
  });
});
