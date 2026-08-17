import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { SmoothTrajectoryModifier } from "../../src/modifiers/SmoothTrajectoryModifier";
import { createDefaultContext } from "../../src/pipeline/types";
import { Trajectory } from "../../src/system/trajectory";

function frameAt(x: number): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array([x]));
  atoms.setColF("y", new Float64Array([0]));
  atoms.setColF("z", new Float64Array([0]));
  atoms.setColStr("element", ["C"]);
  frame.insertBlock("atoms", atoms);
  return frame;
}

describe("SmoothTrajectoryModifier", () => {
  test("averages neighboring frames", () => {
    const frames = [frameAt(0), frameAt(3), frameAt(6)];
    const traj = new Trajectory(frames);
    const app = {
      system: { trajectory: traj },
    } as unknown as MolvisApp;

    const mod = new SmoothTrajectoryModifier();
    mod.setWindowHalf(1);
    // center frame index 1: avg of 0,3,6 = 3
    const out = mod.apply(frames[1], createDefaultContext(frames[1], app, 1));
    expect(out.getBlock("atoms")?.viewColF("x")?.[0]).toBeCloseTo(3, 5);
  });

  test("windowHalf 0 is pass-through", () => {
    const f = frameAt(5);
    const mod = new SmoothTrajectoryModifier();
    mod.setWindowHalf(0);
    const out = mod.apply(f, createDefaultContext(f, {} as MolvisApp, 0));
    expect(out.getBlock("atoms")?.viewColF("x")?.[0]).toBeCloseTo(5, 6);
  });
});
