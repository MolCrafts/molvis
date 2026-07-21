import { Box, Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import { AtomSource, BondSource } from "../src/entity_source";
import type { SceneIndex } from "../src/scene_index";
import { buildFrameFromScene } from "../src/scene_sync";

// buildFrameFromScene only touches sceneIndex.metaRegistry.{atoms,bonds} and
// markAllSaved(), so a mock backed by real AtomSource/BondSource suffices —
// no BabylonJS scene needed.
function mockSceneIndex(atoms: AtomSource, bonds: BondSource): SceneIndex {
  return {
    metaRegistry: { atoms, bonds },
    markAllSaved() {},
  } as unknown as SceneIndex;
}

function sceneWith3Atoms(): SceneIndex {
  const atoms = new AtomSource();
  atoms.setEdit(0, {
    type: "atom",
    atomId: 0,
    element: "C",
    position: { x: 1, y: 2, z: 3 },
  });
  atoms.setEdit(1, {
    type: "atom",
    atomId: 1,
    element: "H",
    position: { x: 4, y: 5, z: 6 },
  });
  const bonds = new BondSource();
  bonds.setEdit(0, {
    type: "bond",
    bondId: 0,
    atomId1: 0,
    atomId2: 1,
    order: 2,
    start: { x: 1, y: 2, z: 3 },
    end: { x: 4, y: 5, z: 6 },
  });
  return mockSceneIndex(atoms, bonds);
}

describe("buildFrameFromScene", () => {
  it("builds a new Frame with the scene's atoms and bonds", () => {
    const frame = buildFrameFromScene(sceneWith3Atoms());
    const a = frame.getBlock("atoms");
    expect(a?.nrows()).toBe(2);
    const x = a?.viewColF("x");
    expect(x && Array.from(x)).toEqual([1, 4]);
    const b = frame.getBlock("bonds");
    expect(b?.nrows()).toBe(1);
    expect(b?.viewColU32("order")?.[0]).toBe(2);
  });

  it("preserves the simulation box from the source frame", () => {
    const sourceFrame = new Frame();
    sourceFrame.box = Box.cube(
      10,
      new Float64Array([0, 0, 0]),
      true,
      true,
      true,
    );
    const frame = buildFrameFromScene(sceneWith3Atoms(), { sourceFrame });
    expect(frame.box).toBeTruthy();
    // The source frame keeps its own box (getter→setter move pattern).
    expect(sourceFrame.box).toBeTruthy();
  });

  it("does NOT mutate/clear the source frame (immutability)", () => {
    const sourceFrame = new Frame();
    sourceFrame.box = Box.cube(
      5,
      new Float64Array([0, 0, 0]),
      true,
      true,
      true,
    );
    buildFrameFromScene(sceneWith3Atoms(), { sourceFrame });
    // Source frame must remain usable and box intact after the build.
    expect(() => sourceFrame.box).not.toThrow();
    expect(sourceFrame.box).toBeTruthy();
  });
});
