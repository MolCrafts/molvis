import { NullEngine } from "@babylonjs/core";
import { Block, Box, Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import { MolvisRenderer } from "../src/renderer";
import { Trajectory } from "../src/system/trajectory";
import "./setup_wasm";

/**
 * Integration tests for World.resetCamera's advanced framing. Builds a GUI-less
 * renderer on a NullEngine, loads real atom frames through the pipeline (which
 * populates the instanceData buffer getBounds/getBoundsData read), then frames
 * the scene. resetCamera does not screenshot, so NullEngine is sufficient.
 */

function makeAtomFrame(
  coords: Array<[number, number, number]>,
  elements: string[],
  box?: Box,
): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array(coords.map((c) => c[0])));
  atoms.setColF("y", new Float64Array(coords.map((c) => c[1])));
  atoms.setColF("z", new Float64Array(coords.map((c) => c[2])));
  atoms.setColStr("element", elements);
  frame.insertBlock("atoms", atoms);
  if (box) frame.simbox = box;
  return frame;
}

function mkRenderer(): MolvisRenderer {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  return new MolvisRenderer(canvas, { engine: new NullEngine() });
}

describe("World.resetCamera — advanced framing", () => {
  it("ac-001: getBounds is radius-aware (extends past atom centers)", async () => {
    const r = mkRenderer();
    try {
      await r.load(
        new Trajectory([
          makeAtomFrame(
            [
              [-5, 0, 0],
              [5, 0, 0],
              [0, 3, 0],
            ],
            ["C", "C", "O"],
          ),
        ]),
      );
      const data = r.app.world.sceneIndex.getBoundsData();
      expect(data).not.toBeNull();
      // Radii were assigned and folded in — the value getBounds used to drop.
      expect(data?.radii.every((rr) => rr > 0)).toBe(true);

      const bounds = r.app.world.sceneIndex.getBounds();
      expect(bounds).not.toBeNull();
      // The farthest atom center is x = ±5; the box must extend past it by r.
      expect(bounds?.max.x).toBeGreaterThan(5);
      expect(bounds?.min.x).toBeLessThan(-5);
    } finally {
      r.dispose();
    }
  });

  it("ac-008: resetCamera() keeps the stable iso angles", async () => {
    const r = mkRenderer();
    try {
      await r.load(
        new Trajectory([
          makeAtomFrame(
            [
              [-5, 0, 0],
              [5, 0, 0],
              [0, 3, 1],
            ],
            ["C", "C", "O"],
          ),
        ]),
      );
      r.app.world.resetCamera();
      expect(r.app.world.camera.alpha).toBeCloseTo(Math.PI / 4, 6);
      expect(r.app.world.camera.beta).toBeCloseTo(Math.PI / 3, 6);
    } finally {
      r.dispose();
    }
  });

  it("ac-006: frameBox pulls the camera back to fit the PBC cell", async () => {
    const r = mkRenderer();
    try {
      const box = Box.cube(
        40,
        new Float64Array([-20, -20, -20]),
        true,
        true,
        true,
      );
      await r.load(
        new Trajectory([
          makeAtomFrame(
            [
              [-1, 0, 0],
              [1, 0, 0],
            ],
            ["C", "C"],
            box,
          ),
        ]),
      );
      r.app.world.resetCamera({ frameBox: false });
      const without = r.app.world.camera.radius;
      r.app.world.resetCamera({ frameBox: true });
      const withBox = r.app.world.camera.radius;
      // The 40 Å cell is far larger than the two atoms, so including its
      // corners must push the camera farther back.
      expect(withBox).toBeGreaterThan(without);
    } finally {
      r.dispose();
    }
  });

  it("ac-010: turntable shared surface still builds with finite framing", async () => {
    const r = mkRenderer();
    try {
      await r.load(
        new Trajectory([
          makeAtomFrame(
            [
              [-5, 0, 0],
              [5, 0, 0],
              [0, 3, 0],
            ],
            ["C", "C", "O"],
          ),
        ]),
      );
      const track = r.app.world.cameraAnimator.buildTurntable({ duration: 1 });
      const pose = track.sample(0.25);
      expect(pose.position.every((v) => Number.isFinite(v))).toBe(true);
      expect(pose.target.every((v) => Number.isFinite(v))).toBe(true);
    } finally {
      r.dispose();
    }
  });

  it("no data → safe fallback (iso angles, finite radius)", () => {
    const r = mkRenderer();
    try {
      r.app.world.resetCamera();
      expect(Number.isFinite(r.app.world.camera.radius)).toBe(true);
      expect(r.app.world.camera.alpha).toBeCloseTo(Math.PI / 4, 6);
      expect(r.app.world.camera.beta).toBeCloseTo(Math.PI / 3, 6);
    } finally {
      r.dispose();
    }
  });
});
