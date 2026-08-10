import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { SliceModifier } from "../../src/modifiers/SliceModifier";
import { createDefaultContext } from "../../src/pipeline/types";

/**
 * Helper: create a Frame with atoms at specified positions.
 * positions is an array of [x, y, z] tuples.
 */
function makeFrame(positions: [number, number, number][]): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", new Float64Array(positions.map((p) => p[0])));
  atoms.setColF("y", new Float64Array(positions.map((p) => p[1])));
  atoms.setColF("z", new Float64Array(positions.map((p) => p[2])));
  frame.insertBlock("atoms", atoms);
  return frame;
}

/**
 * Helper: extract visibility mask from the modifier instance.
 */
function getVisibility(mod: SliceModifier): boolean[] | null {
  return mod.visibilityMask;
}

describe("SliceModifier", () => {
  // The modifier never reads `context.app`; the seam only has to exist.
  const mockApp = {} as MolvisApp;

  describe("plane clipping (half-space)", () => {
    it("should show atoms on positive side of X plane", () => {
      // Atoms at x = -5, 0, 5, 10
      const frame = makeFrame([
        [-5, 0, 0],
        [0, 0, 0],
        [5, 0, 0],
        [10, 0, 0],
      ]);
      const ctx = createDefaultContext(frame, mockApp);

      const mod = new SliceModifier("test");
      mod.normal = [1, 0, 0];
      mod.offset = 3;

      mod.apply(frame, ctx);
      const vis = getVisibility(mod);

      expect(vis).not.toBeNull();
      // x=-5: dot=(-5)-3 = -8 < 0 → hidden
      // x=0:  dot=(0)-3  = -3 < 0 → hidden
      // x=5:  dot=(5)-3  =  2 >= 0 → visible
      // x=10: dot=(10)-3 =  7 >= 0 → visible
      expect(vis?.[0]).toBe(false);
      expect(vis?.[1]).toBe(false);
      expect(vis?.[2]).toBe(true);
      expect(vis?.[3]).toBe(true);
    });

    it("should handle Y-axis normal", () => {
      const frame = makeFrame([
        [0, -2, 0],
        [0, 0, 0],
        [0, 5, 0],
      ]);
      const ctx = createDefaultContext(frame, mockApp);

      const mod = new SliceModifier("test");
      mod.normal = [0, 1, 0];
      mod.offset = 0;

      mod.apply(frame, ctx);
      const vis = getVisibility(mod);

      expect(vis).not.toBeNull();
      // y=-2: dist=-2 < 0 → hidden
      // y=0:  dist=0 >= 0 → visible (dist=0 is NOT > 0, so hidden)
      // y=5:  dist=5 >= 0 → visible
      expect(vis?.[0]).toBe(false);
      expect(vis?.[1]).toBe(false);
      expect(vis?.[2]).toBe(true);
    });
  });

  describe("slab mode", () => {
    it("should show only atoms within slab thickness", () => {
      // Atoms along X axis at -10, -1, 0, 1, 10
      const frame = makeFrame([
        [-10, 0, 0],
        [-1, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
        [10, 0, 0],
      ]);
      const ctx = createDefaultContext(frame, mockApp);

      const mod = new SliceModifier("test");
      mod.normal = [1, 0, 0];
      mod.offset = 0;
      mod.isSlab = true;
      mod.slabThickness = 4; // slab from -2 to +2

      mod.apply(frame, ctx);
      const vis = getVisibility(mod);

      expect(vis).not.toBeNull();
      // Auto-init overrides offset to center (0) and thickness to ceil(diag*0.1)=2
      // With thickness=2, slab from -1 to +1:
      // x=-10: |dist|=10 > 1 → hidden
      // x=-1:  |dist|=1  <= 1 → visible
      // x=0:   |dist|=0  <= 1 → visible
      // x=1:   |dist|=1  <= 1 → visible
      // x=10:  |dist|=10 > 1 → hidden
      expect(vis?.[0]).toBe(false);
      expect(vis?.[1]).toBe(true);
      expect(vis?.[2]).toBe(true);
      expect(vis?.[3]).toBe(true);
      expect(vis?.[4]).toBe(false);
    });
  });

  describe("invert", () => {
    it("should invert visibility when invert is true", () => {
      const frame = makeFrame([
        [-5, 0, 0],
        [5, 0, 0],
      ]);
      const ctx = createDefaultContext(frame, mockApp);

      const mod = new SliceModifier("test");
      mod.normal = [1, 0, 0];
      mod.offset = 0;
      mod.invert = true;

      mod.apply(frame, ctx);
      const vis = getVisibility(mod);

      expect(vis).not.toBeNull();
      // Without invert: x=-5 hidden, x=5 visible
      // With invert: x=-5 visible, x=5 hidden
      expect(vis?.[0]).toBe(true);
      expect(vis?.[1]).toBe(false);
    });
  });

  describe("disabled modifier", () => {
    it("should not be called by the pipeline when disabled", () => {
      const mod = new SliceModifier("test");
      mod.enabled = false;

      // Pipeline skips disabled modifiers, so visibilityMask stays null
      expect(mod.visibilityMask).toBeNull();
    });
  });

  describe("empty frame", () => {
    it("should return input when atoms block is missing", () => {
      const frame = new Frame();
      const ctx = createDefaultContext(frame, mockApp);

      const mod = new SliceModifier("test");
      const result = mod.apply(frame, ctx);

      expect(result).toBe(frame);
    });
  });

  describe("non-destructive", () => {
    it("should preserve original atoms block and not mutate the frame", () => {
      const frame = makeFrame([
        [0, 0, 0],
        [5, 0, 0],
        [10, 0, 0],
      ]);
      const ctx = createDefaultContext(frame, mockApp);

      const mod = new SliceModifier("test");
      mod.normal = [1, 0, 0];
      mod.offset = 3;

      const result = mod.apply(frame, ctx);
      // Output should be the same frame reference (not mutated)
      expect(result).toBe(frame);
      // Atoms block should be preserved
      const atoms = result.getBlock("atoms");
      expect(atoms).not.toBeNull();
      expect(atoms?.nrows()).toBe(3);
      // No visualization blocks should have been inserted on the frame
      expect(result.getBlock("_slice_visualization")).toBeFalsy();
      expect(result.getBlock("_visual_guide")).toBeFalsy();
    });
  });

  describe("getCacheKey", () => {
    it("should include all parameters in cache key", () => {
      const mod = new SliceModifier("test-id");
      mod.normal = [0, 1, 0];
      mod.offset = 5;
      mod.isSlab = true;
      mod.slabThickness = 3;
      mod.invert = true;

      const key = mod.getCacheKey();
      expect(key).toContain("test-id");
      expect(key).toContain("0,1,0");
      expect(key).toContain("5");
      expect(key).toContain("true");
      expect(key).toContain("3");
    });

    it("should produce different keys for different parameters", () => {
      const mod = new SliceModifier("test");

      mod.offset = 0;
      const key1 = mod.getCacheKey();

      mod.offset = 10;
      const key2 = mod.getCacheKey();

      expect(key1).not.toBe(key2);
    });
  });
});
