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
  DataSourceModifier,
  FrameDataSource,
  TrajectoryDataSource,
} from "../src/pipeline/data_source_modifier";
import { ModifierPipeline } from "../src/pipeline/pipeline";
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
