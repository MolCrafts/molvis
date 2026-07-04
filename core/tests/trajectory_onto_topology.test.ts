/**
 * Topology-preserving trajectory load: open a structure that carries bonds
 * (e.g. a LAMMPS `.data`), then drop a positions-only trajectory (e.g. a
 * `.lammpstrj`) and keep the bonds while the positions animate.
 *
 * These cover the pure pieces the `"auto"`/`"append"` merge in
 * `io/index.ts` is built on:
 *   - `extractTopologyFrame` — deep-copy non-atoms blocks into an
 *     independent frame that survives the source's disposal.
 *   - `isStaticTopologyScene` — the "a structure with bonds is open" guard.
 *   - the synthesis behaviour the merge relies on: a length-1 bonds-only
 *     overlay broadcast across a multi-frame, positions-only trajectory.
 */
import { Block, Box, Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import { extractTopologyFrame, isStaticTopologyScene } from "../src/io";
import {
  type SynthesisSource,
  synthesize,
} from "../src/system/scene_synthesis";
import { Trajectory } from "../src/system/trajectory";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Frame with `count` atoms at the given x positions (y = z = 0). */
function makeAtomsFrame(xs: number[], options: { box?: number } = {}): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array(xs));
  atoms.setColF("y", new Float64Array(xs.length));
  atoms.setColF("z", new Float64Array(xs.length));
  frame.insertBlock("atoms", atoms);
  if (options.box !== undefined) {
    frame.simbox = Box.cube(
      new Float64Array([options.box]),
      new Float64Array([0, 0, 0]),
      true,
      true,
      true,
    );
  }
  return frame;
}

/** Topology frame: atoms + one `(0,1)` bond (+ optional extra `angles` block). */
function makeTopologyFrame(withAngles = false): Frame {
  const frame = makeAtomsFrame([0, 1]);
  const bonds = new Block();
  bonds.setColU32("atomi", new Uint32Array([0]));
  bonds.setColU32("atomj", new Uint32Array([1]));
  bonds.setColU32("order", new Uint32Array([1]));
  frame.insertBlock("bonds", bonds);
  if (withAngles) {
    const angles = new Block();
    angles.setColU32("atomi", new Uint32Array([0]));
    angles.setColU32("atomj", new Uint32Array([1]));
    angles.setColU32("atomk", new Uint32Array([0]));
    frame.insertBlock("angles", angles);
  }
  return frame;
}

const AUGMENT = {
  mode: "augment" as const,
  referenceId: null,
  alignment: null,
};

// ── extractTopologyFrame ─────────────────────────────────────────────────────

describe("extractTopologyFrame", () => {
  it("keeps non-atoms blocks and drops atoms", () => {
    const topo = extractTopologyFrame(makeTopologyFrame(true));
    const names = topo.blockNames();
    expect(names).toContain("bonds");
    expect(names).toContain("angles");
    expect(names).not.toContain("atoms");
    expect(topo.getBlock("bonds")?.nrows()).toBe(1);
  });

  it("produces an independent copy that survives the source being freed", () => {
    const source = makeTopologyFrame();
    const topo = extractTopologyFrame(source);
    source.free(); // drop the original's WASM storage (as setTrajectory would)
    const bonds = topo.getBlock("bonds");
    expect(bonds?.nrows()).toBe(1);
    expect(Array.from(bonds?.copyColU32("atomi") ?? [])).toEqual([0]);
  });

  it("returns an empty frame when the source has only atoms", () => {
    const topo = extractTopologyFrame(makeAtomsFrame([0, 1, 2]));
    expect(topo.blockNames()).toHaveLength(0);
  });
});

// ── isStaticTopologyScene ────────────────────────────────────────────────────

describe("isStaticTopologyScene", () => {
  it("true for a single frame carrying bonds", () => {
    expect(isStaticTopologyScene(makeTopologyFrame(), 1)).toBe(true);
  });

  it("false when the timeline already has multiple frames", () => {
    expect(isStaticTopologyScene(makeTopologyFrame(), 3)).toBe(false);
  });

  it("false when the open frame has no bonds", () => {
    expect(isStaticTopologyScene(makeAtomsFrame([0, 1]), 1)).toBe(false);
  });

  it("false for an undefined frame", () => {
    expect(isStaticTopologyScene(undefined, 1)).toBe(false);
  });
});

// ── synthesis: trajectory positions + broadcast topology bonds ───────────────

describe("trajectory-over-topology synthesis", () => {
  // Mirror the runtime pipeline: source 0 is the multi-frame trajectory
  // (positions + box, no bonds); source 1 is the length-1 topology overlay
  // contributing only bonds, broadcast across the timeline.
  const buildSources = (): SynthesisSource[] => {
    const traj = new Trajectory([
      makeAtomsFrame([10, 11], { box: 20 }),
      makeAtomsFrame([20, 21], { box: 20 }),
      makeAtomsFrame([30, 31], { box: 20 }),
    ]);
    const topo = new Trajectory([extractTopologyFrame(makeTopologyFrame())]);
    return [
      { id: "traj", trajectory: traj },
      { id: "topo", trajectory: topo, contributedBlocks: ["bonds"] },
    ];
  };

  it("merges per-frame atoms with the broadcast bonds", async () => {
    const merged = await synthesize(buildSources(), 1, AUGMENT);
    // Positions come from trajectory frame 1.
    expect(Array.from(merged.getBlock("atoms")?.copyColF("x") ?? [])).toEqual([
      20, 21,
    ]);
    // Bonds come from the topology overlay.
    const bonds = merged.getBlock("bonds");
    expect(bonds?.nrows()).toBe(1);
    expect(Array.from(bonds?.copyColU32("atomi") ?? [])).toEqual([0]);
    expect(Array.from(bonds?.copyColU32("atomj") ?? [])).toEqual([1]);
    // Box comes from the trajectory, not the (box-less) topology overlay.
    expect(merged.simbox).toBeDefined();
  });

  it("keeps identical bonds while positions change across frames", async () => {
    const f0 = await synthesize(buildSources(), 0, AUGMENT);
    const f2 = await synthesize(buildSources(), 2, AUGMENT);
    expect(Array.from(f0.getBlock("atoms")?.copyColF("x") ?? [])).toEqual([
      10, 11,
    ]);
    expect(Array.from(f2.getBlock("atoms")?.copyColF("x") ?? [])).toEqual([
      30, 31,
    ]);
    // Bond topology is constant — this is what makes playback a fast
    // position-only update with bonds intact.
    expect(f0.getBlock("bonds")?.nrows()).toBe(1);
    expect(f2.getBlock("bonds")?.nrows()).toBe(1);
  });
});
