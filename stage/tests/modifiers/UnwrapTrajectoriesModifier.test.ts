import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, test } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { UnwrapTrajectoriesModifier } from "../../src/modifiers/UnwrapTrajectoriesModifier";
import { createDefaultContext } from "../../src/pipeline/types";

function frameAt(x: number): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.set("x", new Float64Array([x]));
  atoms.set("y", new Float64Array([0]));
  atoms.set("z", new Float64Array([0]));
  atoms.set("element", ["C"]);
  frame.set("atoms", atoms);
  frame.box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);
  return frame;
}

describe("UnwrapTrajectoriesModifier", () => {
  const mockApp = {} as MolvisApp;

  test("accumulates MIC jump across box boundary", () => {
    const mod = new UnwrapTrajectoriesModifier();
    // Frame 0: x=9
    const f0 = frameAt(9);
    const o0 = mod.apply(f0, createDefaultContext(f0, mockApp, 0));
    expect((o0.get("atoms").view("x") as Float64Array)?.[0]).toBeCloseTo(9, 5);

    // Frame 1: wrapped to x=1 (jumped +2 through PBC from 9 → should be ~11 unwrapped)
    const f1 = frameAt(1);
    const o1 = mod.apply(f1, createDefaultContext(f1, mockApp, 1));
    const x1 = (o1.get("atoms").view("x") as Float64Array)?.[0] ?? 0;
    expect(x1).toBeCloseTo(11, 4);
  });

  test("scrubbing backward re-seeds", () => {
    const mod = new UnwrapTrajectoriesModifier();
    mod.apply(frameAt(0), createDefaultContext(frameAt(0), mockApp, 0));
    mod.apply(frameAt(1), createDefaultContext(frameAt(1), mockApp, 1));
    const o = mod.apply(
      frameAt(5),
      createDefaultContext(frameAt(5), mockApp, 0),
    );
    expect((o.get("atoms").view("x") as Float64Array)?.[0]).toBeCloseTo(5, 5);
  });
});
