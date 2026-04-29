/**
 * State-transition tests for the multi-data-source pipeline. Covers the
 * spec's State Transitions table (`docs/specs/multi-data-source-pipeline.md`).
 *
 * These tests exercise the pipeline + DataSourceModifier subclasses in
 * isolation: they do not boot a full MolvisApp (which would need
 * BabylonJS / a canvas / etc.). State transitions are driven by direct
 * `pipeline.addModifier` / `pipeline.removeModifier` calls plus the
 * spec's two-phase `compute()` which reads from DSs.
 */

import { Block, Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import type { MolvisApp } from "../src/app";
import {
  type BondColumnMapping,
  BondColumnRemapModifier,
  bondsIntegerColumns,
  bondsNeedColumnMapping,
} from "../src/pipeline/bond_column_remap";
import {
  DataSourceModifier,
  FrameDataSource,
  TrajectoryDataSource,
} from "../src/pipeline/data_source_modifier";
import { ModifierPipeline } from "../src/pipeline/pipeline";
import { createDefaultContext } from "../src/pipeline/types";
import { SceneIndex } from "../src/scene_index";
import { Trajectory } from "../src/system/trajectory";

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function makeAtomsFrame(elements: string[]): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array(elements.length));
  atoms.setColF("y", new Float64Array(elements.length));
  atoms.setColF("z", new Float64Array(elements.length));
  atoms.setColStr("element", elements);
  frame.insertBlock("atoms", atoms);
  return frame;
}

function makeBondsFrame(pairs: Array<[number, number]>): Frame {
  const frame = new Frame();
  const bonds = new Block();
  const i = new Uint32Array(pairs.length);
  const j = new Uint32Array(pairs.length);
  const order = new Uint32Array(pairs.length);
  for (let k = 0; k < pairs.length; k++) {
    i[k] = pairs[k][0];
    j[k] = pairs[k][1];
    order[k] = 1;
  }
  bonds.setColU32("i", i);
  bonds.setColU32("j", j);
  bonds.setColU32("order", order);
  frame.insertBlock("bonds", bonds);
  return frame;
}

function makeMultiFrameTraj(
  count: number,
  elementsPerFrame: string[],
): Trajectory {
  const frames: Frame[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(makeAtomsFrame(elementsPerFrame));
  }
  return new Trajectory(frames);
}

const mockApp = {} as MolvisApp;

// ---------------------------------------------------------------------------
//  Phase A merge
// ---------------------------------------------------------------------------

describe("pipeline.compute phase A — DS merge", () => {
  it("empty pipeline produces an empty merged frame", async () => {
    const pipeline = new ModifierPipeline();
    const merged = await pipeline.compute(0, mockApp);
    expect(merged.getBlock("atoms")).toBeUndefined();
    expect(merged.getBlock("bonds")).toBeUndefined();
  });

  it("single TrajectoryDataSource contributes its frame at the requested index", async () => {
    const pipeline = new ModifierPipeline();
    const traj = makeMultiFrameTraj(3, ["C", "O", "N"]);
    pipeline.addModifier(new TrajectoryDataSource(traj));

    const merged = await pipeline.compute(1, mockApp);
    expect(merged.getBlock("atoms")?.nrows()).toBe(3);
  });

  it("FrameDataSource broadcasts its single frame across any compute index", async () => {
    const pipeline = new ModifierPipeline();
    const fds = new FrameDataSource(makeBondsFrame([[0, 1]]));
    pipeline.addModifier(fds);

    for (const i of [0, 5, 100]) {
      const merged = await pipeline.compute(i, mockApp);
      expect(merged.getBlock("bonds")?.nrows()).toBe(1);
    }
  });

  it("TrajectoryDataSource + FrameDataSource stack: atoms from traj, bonds from frame", async () => {
    const pipeline = new ModifierPipeline();
    const traj = makeMultiFrameTraj(2, ["C", "O"]);
    pipeline.addModifier(new TrajectoryDataSource(traj));
    pipeline.addModifier(new FrameDataSource(makeBondsFrame([[0, 1]])));

    const merged = await pipeline.compute(0, mockApp);
    expect(merged.getBlock("atoms")?.nrows()).toBe(2);
    expect(merged.getBlock("bonds")?.nrows()).toBe(1);

    // Static topology broadcasts: same bonds across every frame
    const merged1 = await pipeline.compute(1, mockApp);
    expect(merged1.getBlock("bonds")?.nrows()).toBe(1);
  });

  it("last-wins on block conflict (later DS overwrites earlier)", async () => {
    const pipeline = new ModifierPipeline();
    pipeline.addModifier(new FrameDataSource(makeAtomsFrame(["C", "C", "C"])));
    pipeline.addModifier(new FrameDataSource(makeAtomsFrame(["O", "O"])));

    const merged = await pipeline.compute(0, mockApp);
    // Second DS contributed atoms: 2 elements, not 3
    expect(merged.getBlock("atoms")?.nrows()).toBe(2);
  });

  it("disabled DS is skipped during phase A", async () => {
    const pipeline = new ModifierPipeline();
    const ds1 = new FrameDataSource(makeAtomsFrame(["C", "O"]));
    pipeline.addModifier(ds1);
    ds1.enabled = false;

    const merged = await pipeline.compute(0, mockApp);
    expect(merged.getBlock("atoms")).toBeUndefined();
  });

  it("contributedBlocks narrows what a DS exposes", async () => {
    const pipeline = new ModifierPipeline();
    const trajFrame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", new Float64Array([1, 2]));
    atoms.setColF("y", new Float64Array([0, 0]));
    atoms.setColF("z", new Float64Array([0, 0]));
    atoms.setColStr("element", ["C", "O"]);
    trajFrame.insertBlock("atoms", atoms);
    const bonds = new Block();
    bonds.setColU32("i", new Uint32Array([0]));
    bonds.setColU32("j", new Uint32Array([1]));
    bonds.setColU32("order", new Uint32Array([1]));
    trajFrame.insertBlock("bonds", bonds);

    // DS contributes only bonds, even though its source frame has both.
    pipeline.addModifier(
      new FrameDataSource(trajFrame, { contributedBlocks: ["bonds"] }),
    );

    const merged = await pipeline.compute(0, mockApp);
    expect(merged.getBlock("atoms")).toBeUndefined();
    expect(merged.getBlock("bonds")?.nrows()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
//  Pipeline state — array order, removal, isolation
// ---------------------------------------------------------------------------

describe("pipeline state — DS lifecycle", () => {
  it("adding a TrajectoryDataSource then a FrameDataSource yields {T, F} state", () => {
    const pipeline = new ModifierPipeline();
    pipeline.addModifier(
      new TrajectoryDataSource(makeMultiFrameTraj(5, ["C"])),
    );
    pipeline.addModifier(new FrameDataSource(makeBondsFrame([[0, 0]])));

    const dsList = pipeline
      .getModifiers()
      .filter((m): m is DataSourceModifier => m instanceof DataSourceModifier);
    expect(dsList.length).toBe(2);
    expect(dsList[0]).toBeInstanceOf(TrajectoryDataSource);
    expect(dsList[1]).toBeInstanceOf(FrameDataSource);
  });

  it("removing the FrameDataSource leaves the TrajectoryDataSource intact", () => {
    const pipeline = new ModifierPipeline();
    pipeline.addModifier(
      new TrajectoryDataSource(makeMultiFrameTraj(5, ["C"])),
    );
    const fds = new FrameDataSource(makeBondsFrame([[0, 0]]));
    pipeline.addModifier(fds);

    pipeline.removeModifier(fds.id);
    const remaining = pipeline
      .getModifiers()
      .filter((m): m is DataSourceModifier => m instanceof DataSourceModifier);
    expect(remaining.length).toBe(1);
    expect(remaining[0]).toBeInstanceOf(TrajectoryDataSource);
  });

  it("removing the TrajectoryDataSource leaves only FrameDataSource → system collapses to 1 frame", async () => {
    const pipeline = new ModifierPipeline();
    const tds = new TrajectoryDataSource(makeMultiFrameTraj(10, ["C", "O"]));
    pipeline.addModifier(tds);
    pipeline.addModifier(new FrameDataSource(makeBondsFrame([[0, 1]])));

    pipeline.removeModifier(tds.id);

    // Remaining DS contributes 1 frame; phase A produces just the bonds.
    const merged = await pipeline.compute(0, mockApp);
    expect(merged.getBlock("atoms")).toBeUndefined();
    expect(merged.getBlock("bonds")?.nrows()).toBe(1);
  });

  it("removing all DSs leaves the pipeline producing an empty frame", async () => {
    const pipeline = new ModifierPipeline();
    const tds = new TrajectoryDataSource(makeMultiFrameTraj(3, ["C"]));
    pipeline.addModifier(tds);
    pipeline.removeModifier(tds.id);

    const merged = await pipeline.compute(0, mockApp);
    expect(merged.getBlock("atoms")).toBeUndefined();
    expect(merged.getBlock("bonds")).toBeUndefined();
  });

  it("two TrajectoryDataSources stack their blocks in array order at the same index", async () => {
    const pipeline = new ModifierPipeline();
    const traj1 = makeMultiFrameTraj(4, ["C", "O", "N"]);
    pipeline.addModifier(new TrajectoryDataSource(traj1));

    // Second trajectory: same length, different atom count — last wins
    const traj2 = makeMultiFrameTraj(4, ["H", "H", "H", "H", "H"]);
    pipeline.addModifier(new TrajectoryDataSource(traj2));

    const merged = await pipeline.compute(2, mockApp);
    // Last DS's atoms block (5 H atoms) wins
    expect(merged.getBlock("atoms")?.nrows()).toBe(5);
  });
});

// ---------------------------------------------------------------------------
//  Parent-child grouping (phase 2: DS-as-parent for visual nesting)
// ---------------------------------------------------------------------------

describe("setParent — DS as parent (visual grouping)", () => {
  it("Draw modifier can nest under a DataSourceModifier", async () => {
    // Lazy import to avoid pulling Draw modules into the helper section
    const { DrawAtomModifier } = await import("../src/pipeline/draw_atom");

    const pipeline = new ModifierPipeline();
    const ds = new TrajectoryDataSource(makeMultiFrameTraj(2, ["C"]));
    pipeline.addModifier(ds);

    const draw = new DrawAtomModifier();
    pipeline.addModifier(draw);

    const ok = pipeline.setParent(draw.id, ds.id);
    expect(ok).toBe(true);
    expect(draw.parentId).toBe(ds.id);
    expect(pipeline.getChildren(ds.id).length).toBe(1);
  });

  it("non-ConsumesSelection child is allowed under a DS parent", async () => {
    const { DrawBondModifier } = await import("../src/pipeline/draw_bond");

    const pipeline = new ModifierPipeline();
    const ds = new FrameDataSource(makeBondsFrame([[0, 1]]));
    pipeline.addModifier(ds);

    const draw = new DrawBondModifier();
    pipeline.addModifier(draw);
    // DrawBondModifier doesn't have ConsumesSelection — old rule would
    // reject this; new DS-as-parent branch accepts it.
    expect(pipeline.setParent(draw.id, ds.id)).toBe(true);
  });

  it("topology-changing child still cannot have any parent (DS or selection)", async () => {
    const { HideSelectionModifier } = await import(
      "../src/modifiers/HideSelectionModifier"
    );

    const pipeline = new ModifierPipeline();
    const ds = new TrajectoryDataSource(makeMultiFrameTraj(1, ["C"]));
    pipeline.addModifier(ds);

    const hide = new HideSelectionModifier();
    pipeline.addModifier(hide);
    // HideSelection is topology-changing; DS-as-parent rule does NOT
    // override that.
    expect(pipeline.setParent(hide.id, ds.id)).toBe(false);
    expect(hide.parentId).toBeNull();
  });

  it("setParent(null) detaches a child from its DS parent", async () => {
    const { DrawAtomModifier } = await import("../src/pipeline/draw_atom");

    const pipeline = new ModifierPipeline();
    const ds = new TrajectoryDataSource(makeMultiFrameTraj(1, ["C"]));
    pipeline.addModifier(ds);
    const draw = new DrawAtomModifier();
    pipeline.addModifier(draw);
    pipeline.setParent(draw.id, ds.id);

    expect(pipeline.setParent(draw.id, null)).toBe(true);
    expect(draw.parentId).toBeNull();
    expect(pipeline.getChildren(ds.id).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
//  Override bridge (legacy applyPipeline path)
// ---------------------------------------------------------------------------

describe("pipeline.compute override bridge", () => {
  it("overrideFrame short-circuits phase A even when DSs are present", async () => {
    const pipeline = new ModifierPipeline();
    pipeline.addModifier(
      new TrajectoryDataSource(makeMultiFrameTraj(2, ["C"])),
    );

    const externalFrame = makeAtomsFrame(["X", "X", "X", "X", "X"]);
    const merged = await pipeline.compute(0, mockApp, "full", externalFrame);

    // Override wins: 5 X atoms, not the DS's 1 C atom
    expect(merged.getBlock("atoms")?.nrows()).toBe(5);
  });
});

// ---------------------------------------------------------------------------
//  Phase 5 — dispose chain (deterministic resource cleanup)
// ---------------------------------------------------------------------------

describe("DataSource dispose chain", () => {
  it("removeModifier on a DataSourceModifier does NOT call dispose by itself (caller's job)", () => {
    // pipeline.removeModifier is a low-level structural op. Disposal is
    // explicit at the higher level (MolvisApp.removeDataSource +
    // pipeline.clear). This guards against accidental double-dispose.
    const pipeline = new ModifierPipeline();
    let disposeCalls = 0;
    const traj = makeMultiFrameTraj(2, ["C"]);
    const ds = new TrajectoryDataSource(traj);
    const origDispose = ds.dispose.bind(ds);
    ds.dispose = () => {
      disposeCalls++;
      origDispose();
    };
    pipeline.addModifier(ds);
    pipeline.removeModifier(ds.id);
    expect(disposeCalls).toBe(0);
  });

  it("pipeline.clear() disposes every DataSourceModifier", () => {
    const pipeline = new ModifierPipeline();

    let disposeCount = 0;
    const ds1 = new TrajectoryDataSource(makeMultiFrameTraj(2, ["C"]));
    const ds2 = new FrameDataSource(makeBondsFrame([[0, 1]]));
    for (const ds of [ds1, ds2]) {
      const orig = ds.dispose.bind(ds);
      ds.dispose = () => {
        disposeCount++;
        orig();
      };
    }
    pipeline.addModifier(ds1);
    pipeline.addModifier(ds2);

    pipeline.clear();
    expect(disposeCount).toBe(2);
    expect(pipeline.getModifiers().length).toBe(0);
  });

  it("pipeline.clear() tolerates a DS whose dispose throws", () => {
    const pipeline = new ModifierPipeline();
    const ds1 = new TrajectoryDataSource(makeMultiFrameTraj(1, ["C"]));
    ds1.dispose = () => {
      throw new Error("simulated dispose failure");
    };
    pipeline.addModifier(ds1);

    // Must not propagate; pipeline still ends up empty.
    expect(() => pipeline.clear()).not.toThrow();
    expect(pipeline.getModifiers().length).toBe(0);
  });

  it("TrajectoryDataSource.dispose forwards to the wrapped Trajectory.dispose", () => {
    const traj = makeMultiFrameTraj(2, ["C"]);
    let trajDisposed = false;
    const origDispose = traj.dispose.bind(traj);
    traj.dispose = () => {
      trajDisposed = true;
      origDispose();
    };
    const ds = new TrajectoryDataSource(traj);
    ds.dispose();
    expect(trajDisposed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
//  SceneIndex.unregisterBox — multi-DrawBox safety
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
//  Default block propagation — the merge consults frame.blockNames(), not
//  a hardcoded registry. New block kinds flow through automatically.
// ---------------------------------------------------------------------------

describe("phase A merge — empty contributedBlocks propagates all blocks", () => {
  it("propagates every non-empty block present on the source frame", async () => {
    const pipeline = new ModifierPipeline();
    const frame = makeAtomsFrame(["C", "O"]);
    const bonds = new Block();
    bonds.setColU32("atomi", new Uint32Array([0]));
    bonds.setColU32("atomj", new Uint32Array([1]));
    frame.insertBlock("bonds", bonds);
    pipeline.addModifier(new FrameDataSource(frame));

    const merged = await pipeline.compute(0, mockApp);
    expect(merged.getBlock("atoms")?.nrows()).toBe(2);
    expect(merged.getBlock("bonds")?.nrows()).toBe(1);
  });

  it("propagates novel block kinds without registry edits", async () => {
    // The merge has no business knowing what blocks "exist" — it must
    // forward whatever the source frame carries. This guards against
    // regressing back to a hardcoded ['atoms','bonds','grid'] list.
    const pipeline = new ModifierPipeline();
    const frame = new Frame();
    const exotic = new Block();
    exotic.setColF("value", new Float64Array([1, 2, 3]));
    frame.insertBlock("custom-block", exotic);
    pipeline.addModifier(new FrameDataSource(frame));

    const merged = await pipeline.compute(0, mockApp);
    expect(merged.getBlock("custom-block")?.nrows()).toBe(3);
  });

  it("skips zero-row blocks so empty placeholders don't shadow real data", async () => {
    const pipeline = new ModifierPipeline();
    // DS A: real atoms.
    pipeline.addModifier(new FrameDataSource(makeAtomsFrame(["C", "O"])));
    // DS B: empty atoms placeholder + real bonds.
    const topoFrame = new Frame();
    const emptyAtoms = new Block();
    emptyAtoms.setColF("x", new Float64Array(0));
    topoFrame.insertBlock("atoms", emptyAtoms);
    const bonds = new Block();
    bonds.setColU32("atomi", new Uint32Array([0]));
    bonds.setColU32("atomj", new Uint32Array([1]));
    topoFrame.insertBlock("bonds", bonds);
    pipeline.addModifier(new FrameDataSource(topoFrame));

    const merged = await pipeline.compute(0, mockApp);
    // DS A's atoms survive — DS B's empty placeholder did NOT shadow.
    expect(merged.getBlock("atoms")?.nrows()).toBe(2);
    expect(merged.getBlock("bonds")?.nrows()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
//  BondColumnRemapModifier — OVITO-style column remap
// ---------------------------------------------------------------------------

function makeRawBondsFrame(
  pairs: Array<[number, number]>,
  iCol = "batom1",
  jCol = "batom2",
): Frame {
  const frame = new Frame();
  const bonds = new Block();
  const i = new Uint32Array(pairs.length);
  const j = new Uint32Array(pairs.length);
  for (let k = 0; k < pairs.length; k++) {
    i[k] = pairs[k][0];
    j[k] = pairs[k][1];
  }
  bonds.setColU32(iCol, i);
  bonds.setColU32(jCol, j);
  frame.insertBlock("bonds", bonds);
  return frame;
}

describe("BondColumnRemapModifier", () => {
  const ctx = createDefaultContext(new Frame(), {} as MolvisApp, 0, "full");

  it("emits atomi/atomj as u32 with offset applied", () => {
    // 1-indexed pairs: (1,2), (2,3) → after offset -1: (0,1), (1,2)
    const frame = makeRawBondsFrame([
      [1, 2],
      [2, 3],
    ]);
    const m = new BondColumnRemapModifier("test-remap", {
      atomiSource: "batom1",
      atomjSource: "batom2",
      offset: -1,
    });

    m.apply(frame, ctx);

    const bonds = frame.getBlock("bonds");
    expect(bonds).toBeDefined();
    expect(bonds?.dtype("atomi")).toBe("u32");
    expect(bonds?.dtype("atomj")).toBe("u32");
    expect(Array.from(bonds?.copyColU32("atomi") ?? [])).toEqual([0, 1]);
    expect(Array.from(bonds?.copyColU32("atomj") ?? [])).toEqual([1, 2]);
  });

  it("is idempotent — re-running on an already-canonical block doesn't double-shift", () => {
    const frame = makeRawBondsFrame([[5, 6]]);
    const m = new BondColumnRemapModifier("test-remap", {
      atomiSource: "batom1",
      atomjSource: "batom2",
      offset: -1,
    });

    m.apply(frame, ctx); // 5,6 → atomi=4, atomj=5
    m.apply(frame, ctx); // no-op: atomi/atomj already exist

    const bonds = frame.getBlock("bonds");
    const ai = bonds?.copyColU32("atomi");
    const aj = bonds?.copyColU32("atomj");
    expect(Array.from(ai ?? [])).toEqual([4]);
    expect(Array.from(aj ?? [])).toEqual([5]);
  });

  it("offset = 0 renames without shifting values", () => {
    const frame = makeRawBondsFrame([[7, 8]]);
    const m = new BondColumnRemapModifier("test-remap", {
      atomiSource: "batom1",
      atomjSource: "batom2",
      offset: 0,
    });

    m.apply(frame, ctx);

    const bonds = frame.getBlock("bonds");
    expect(Array.from(bonds?.copyColU32("atomi") ?? [])).toEqual([7]);
    expect(Array.from(bonds?.copyColU32("atomj") ?? [])).toEqual([8]);
  });

  it("does nothing when source columns aren't present (mismatched mapping)", () => {
    const frame = makeRawBondsFrame([[1, 2]], "c_1[2]", "c_1[3]");
    const m = new BondColumnRemapModifier("test-remap", {
      atomiSource: "wrong",
      atomjSource: "alsowrong",
      offset: -1,
    });

    m.apply(frame, ctx);

    const bonds = frame.getBlock("bonds");
    expect(bonds?.dtype("atomi")).toBeUndefined();
    expect(bonds?.dtype("c_1[2]")).toBeDefined();
  });

  it("accepts f64 source columns (LAMMPS dump default storage type)", () => {
    // The LAMMPS dump parser stores any column outside its small
    // allowlist (id/type/mol/...) as f64, even when the values are
    // logically atom IDs. The remap must truncate-and-cast on rewrite.
    const frame = new Frame();
    const bonds = new Block();
    bonds.setColF("batom1", new Float64Array([1.0, 2.0, 3.0]));
    bonds.setColF("batom2", new Float64Array([2.0, 3.0, 4.0]));
    frame.insertBlock("bonds", bonds);

    const m = new BondColumnRemapModifier("test-remap", {
      atomiSource: "batom1",
      atomjSource: "batom2",
      offset: -1,
    });
    m.apply(frame, ctx);

    const out = frame.getBlock("bonds");
    expect(out?.dtype("atomi")).toBe("u32");
    expect(Array.from(out?.copyColU32("atomi") ?? [])).toEqual([0, 1, 2]);
    expect(Array.from(out?.copyColU32("atomj") ?? [])).toEqual([1, 2, 3]);
  });

  it("does nothing when bonds block is absent", () => {
    const frame = makeAtomsFrame(["C", "O"]);
    const m = new BondColumnRemapModifier("test-remap", {
      atomiSource: "batom1",
      atomjSource: "batom2",
      offset: -1,
    });
    expect(() => m.apply(frame, ctx)).not.toThrow();
    expect(frame.getBlock("bonds")).toBeUndefined();
  });

  it("looks up atom IDs through atoms.id when present (file-row order shuffled)", () => {
    // Real-world LAMMPS scenario: atoms.dump's file-row order is
    // shuffled (MPI rank distribution). A simple offset can't recover
    // the right row position because id != row+constant. The remap
    // modifier resolves bond endpoints via the atoms.id column instead.
    //
    // Atoms (file order, shuffled): id=3, id=1, id=2 at rows 0, 1, 2.
    // Bonds reference atom IDs: (1, 2), (2, 3).
    // Expected canonical pairs: (row of id=1, row of id=2) = (1, 2);
    // (row of id=2, row of id=3) = (2, 0).
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColI32("id", new Int32Array([3, 1, 2]));
    atoms.setColF("x", new Float64Array([9.0, 1.0, 5.0]));
    frame.insertBlock("atoms", atoms);

    const bonds = new Block();
    bonds.setColU32("batom1", new Uint32Array([1, 2]));
    bonds.setColU32("batom2", new Uint32Array([2, 3]));
    frame.insertBlock("bonds", bonds);

    const m = new BondColumnRemapModifier("test-remap", {
      atomiSource: "batom1",
      atomjSource: "batom2",
      offset: 0, // Ignored on the id-lookup path.
    });
    m.apply(frame, ctx);

    const out = frame.getBlock("bonds");
    expect(Array.from(out?.copyColU32("atomi") ?? [])).toEqual([1, 2]);
    expect(Array.from(out?.copyColU32("atomj") ?? [])).toEqual([2, 0]);
  });

  it("handles sparse / non-contiguous atom IDs via id lookup", () => {
    // IDs {7, 12, 25} — no constant offset can map these to row indices.
    // Bond batom1=12 → row 1; batom2=25 → row 2.
    const frame = new Frame();
    const atoms = new Block();
    atoms.setColI32("id", new Int32Array([7, 12, 25]));
    atoms.setColF("x", new Float64Array([0.0, 1.0, 2.0]));
    frame.insertBlock("atoms", atoms);

    const bonds = new Block();
    bonds.setColU32("batom1", new Uint32Array([12]));
    bonds.setColU32("batom2", new Uint32Array([25]));
    frame.insertBlock("bonds", bonds);

    const m = new BondColumnRemapModifier("test-remap", {
      atomiSource: "batom1",
      atomjSource: "batom2",
      offset: -1,
    });
    m.apply(frame, ctx);

    const out = frame.getBlock("bonds");
    expect(Array.from(out?.copyColU32("atomi") ?? [])).toEqual([1]);
    expect(Array.from(out?.copyColU32("atomj") ?? [])).toEqual([2]);
  });
});

describe("bondsNeedColumnMapping / bondsIntegerColumns", () => {
  it("flags a non-canonical bonds block as needing mapping", () => {
    const frame = makeRawBondsFrame([
      [1, 2],
      [2, 3],
    ]);
    expect(bondsNeedColumnMapping(frame)).toBe(true);
    expect(bondsIntegerColumns(frame).sort()).toEqual(["batom1", "batom2"]);
  });

  it("does not flag a canonical bonds block", () => {
    const frame = makeBondsFrame([[0, 1]]);
    // makeBondsFrame uses i/j/order — also non-canonical for atomi/atomj.
    // Build a canonical one inline to verify the negative case.
    const canonical = new Frame();
    const bonds = new Block();
    bonds.setColU32("atomi", new Uint32Array([0, 1]));
    bonds.setColU32("atomj", new Uint32Array([1, 2]));
    canonical.insertBlock("bonds", bonds);
    expect(bondsNeedColumnMapping(canonical)).toBe(false);
    // The makeBondsFrame helper happens to use "i"/"j", which also
    // need mapping under our predicate.
    expect(bondsNeedColumnMapping(frame)).toBe(true);
  });

  it("returns no candidates when the bonds block is absent", () => {
    expect(bondsIntegerColumns(new Frame())).toEqual([]);
    expect(bondsNeedColumnMapping(new Frame())).toBe(false);
  });
});

describe("Phase A merge + bond remap (multi-DS integration)", () => {
  // Validates the full ingestion path the OVITO column-mapper enables:
  // an atoms-only DS + a bonds-only DS with non-canonical columns +
  // BondColumnRemapModifier as the bonds DS's child. After phase A merge
  // and phase B's remap, the working frame carries both blocks with the
  // canonical schema — DrawBondModifier (which reads `atomi`/`atomj`)
  // would then render bonds against the merged atoms.
  it("produces a frame with atoms + canonical bonds after remap", async () => {
    const pipeline = new ModifierPipeline();

    const atomsTraj = makeMultiFrameTraj(1, ["C", "O", "H"]);
    pipeline.addModifier(new TrajectoryDataSource(atomsTraj));

    const bondsFrame = makeRawBondsFrame([
      [1, 2],
      [2, 3],
    ]);
    const bondsDS = new FrameDataSource(bondsFrame, {
      contributedBlocks: ["bonds"],
    });
    pipeline.addModifier(bondsDS);

    const remap = new BondColumnRemapModifier("remap-1", {
      atomiSource: "batom1",
      atomjSource: "batom2",
      offset: -1,
    });
    pipeline.addModifier(remap);
    pipeline.setParent(remap.id, bondsDS.id);

    const merged = await pipeline.compute(0, mockApp);
    const atoms = merged.getBlock("atoms");
    const bonds = merged.getBlock("bonds");
    expect(atoms?.nrows()).toBe(3);
    expect(bonds?.nrows()).toBe(2);
    expect(Array.from(bonds?.copyColU32("atomi") ?? [])).toEqual([0, 1]);
    expect(Array.from(bonds?.copyColU32("atomj") ?? [])).toEqual([1, 2]);
  });
});

describe("SceneIndex.unregisterBox", () => {
  // Regression: dropping a topology-only DS on top of an atoms DS auto-
  // attached a second DrawBoxModifier (both DSs match `frame.simbox`).
  // The second DrawBox.apply ran `sceneIndex.unregister(meshId)` to drop
  // the previous sim_box, but that method ignored its argument and called
  // `clear()`, wiping the atom layer the first DrawBox.apply had just
  // registered. After the GPU flush the atom mesh saw `totalCount === 0`
  // and disabled itself, so the previously-rendered atoms vanished.
  it("clears box meta but preserves atom and bond meta state", () => {
    const idx = new SceneIndex();

    idx.metaRegistry.box = {
      type: "box",
      dimensions: [10, 10, 10],
      origin: [0, 0, 0],
    };
    idx.metaRegistry.atoms.setEdit(42, { type: "atom", atomId: 42 });
    idx.metaRegistry.bonds.setEdit(7, {
      type: "bond",
      bondId: 7,
      atomId1: 0,
      atomId2: 1,
    });

    idx.unregisterBox();

    expect(idx.metaRegistry.box).toBeNull();
    expect(idx.metaRegistry.atoms.getMeta(42)).toBeDefined();
    expect(idx.metaRegistry.bonds.getMeta(7)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
//  Frame count derivation
// ---------------------------------------------------------------------------

describe("DataSource frame counts drive the system timeline", () => {
  it("FrameDataSource always reports 1, regardless of trajectory length", () => {
    const ds = new FrameDataSource(makeAtomsFrame(["C"]));
    expect(ds.frameCount).toBe(1);
  });

  it("TrajectoryDataSource frame count mirrors its wrapped Trajectory", () => {
    const ds = new TrajectoryDataSource(makeMultiFrameTraj(7, ["C"]));
    expect(ds.frameCount).toBe(7);
  });

  it("dispose on TrajectoryDataSource forwards to the wrapped trajectory", () => {
    const traj = makeMultiFrameTraj(2, ["C"]);
    const ds = new TrajectoryDataSource(traj);
    expect(traj.length).toBe(2);
    ds.dispose();
    // Trajectory.dispose is idempotent and doesn't change `length`,
    // but should be safe to call even after the DS is dropped.
    expect(() => ds.dispose()).not.toThrow();
  });
});
