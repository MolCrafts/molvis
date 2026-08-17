import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { frameToTrajectory, Trajectory } from "../../src/system/trajectory";

function makeFrames(n: number): Frame[] {
  return Array.from({ length: n }, () => new Frame());
}

describe("Trajectory", () => {
  describe("constructor", () => {
    it("should initialize with frames", () => {
      const traj = new Trajectory(makeFrames(3));
      expect(traj.length).toBe(3);
      expect(traj.currentIndex).toBe(0);
    });

    it("should handle empty trajectory", () => {
      const traj = new Trajectory([]);
      expect(traj.length).toBe(0);
      expect(traj.currentFrame).toBeTruthy(); // returns new Frame()
    });
  });

  describe("next / prev", () => {
    it("next should advance index", () => {
      const traj = new Trajectory(makeFrames(3));
      expect(traj.next()).toBe(true);
      expect(traj.currentIndex).toBe(1);
    });

    it("next should return false at last frame", () => {
      const traj = new Trajectory(makeFrames(2));
      traj.next();
      expect(traj.next()).toBe(false);
      expect(traj.currentIndex).toBe(1);
    });

    it("prev should go backward", () => {
      const traj = new Trajectory(makeFrames(3));
      traj.next();
      traj.next();
      expect(traj.prev()).toBe(true);
      expect(traj.currentIndex).toBe(1);
    });

    it("prev should return false at first frame", () => {
      const traj = new Trajectory(makeFrames(3));
      expect(traj.prev()).toBe(false);
      expect(traj.currentIndex).toBe(0);
    });

    it("next/prev on empty trajectory returns false", () => {
      const traj = new Trajectory([]);
      expect(traj.next()).toBe(false);
      expect(traj.prev()).toBe(false);
    });
  });

  describe("seek", () => {
    it("should jump to index", () => {
      const traj = new Trajectory(makeFrames(10));
      expect(traj.seek(5)).toBe(true);
      expect(traj.currentIndex).toBe(5);
    });

    it("should clamp to last frame", () => {
      const traj = new Trajectory(makeFrames(5));
      traj.seek(100);
      expect(traj.currentIndex).toBe(4);
    });

    it("should clamp negative to 0", () => {
      const traj = new Trajectory(makeFrames(5));
      traj.seek(2);
      traj.seek(-10);
      expect(traj.currentIndex).toBe(0);
    });

    it("should return false if already at target", () => {
      const traj = new Trajectory(makeFrames(5));
      expect(traj.seek(0)).toBe(false);
    });

    it("should return false for empty trajectory", () => {
      const traj = new Trajectory([]);
      expect(traj.seek(0)).toBe(false);
    });
  });

  describe("addFrame", () => {
    it("should grow the trajectory", () => {
      const traj = new Trajectory(makeFrames(2));
      expect(traj.length).toBe(2);
      traj.addFrame(new Frame());
      expect(traj.length).toBe(3);
    });
  });

  describe("replaceFrame", () => {
    it("should replace frame at valid index", () => {
      const traj = new Trajectory(makeFrames(3));
      const newFrame = new Frame();
      expect(traj.replaceFrame(1, newFrame)).toBe(true);
    });

    it("should return false for out-of-range index", () => {
      const traj = new Trajectory(makeFrames(3));
      expect(traj.replaceFrame(10, new Frame())).toBe(false);
      expect(traj.replaceFrame(-1, new Frame())).toBe(false);
    });
  });

  describe("dispose", () => {
    it("frees owned frames and empties the trajectory", () => {
      const frames = makeFrames(3);
      const traj = new Trajectory(frames);
      traj.dispose();
      expect(traj.length).toBe(0);
      // Frames were freed: accessing a freed WASM Frame throws.
      expect(() => frames[0].getBlock("atoms")).toThrow();
    });

    it("does not free frames listed in the exclude set", () => {
      const frames = makeFrames(2);
      const keep = frames[1];
      const traj = new Trajectory(frames);
      traj.dispose(new Set([keep]));
      // The excluded frame is still alive and usable.
      expect(() => keep.getBlock("atoms")).not.toThrow();
    });

    it("is a no-op for lazy/provider-backed trajectories", () => {
      const frames = makeFrames(4);
      const provider = {
        length: frames.length,
        get: (index: number) => frames[index],
      };
      const traj = Trajectory.fromProvider(provider);
      traj.dispose();
      // Provider owns frame lifetime — nothing was freed, length preserved.
      expect(traj.length).toBe(4);
      expect(() => frames[0].getBlock("atoms")).not.toThrow();
    });
  });

  describe("fromAsyncProvider prefetch", () => {
    it("populates LRU for neighbors without changing currentIndex", async () => {
      const frames = makeFrames(4);
      const gets: number[] = [];
      const provider = {
        length: frames.length,
        get: async (index: number) => {
          gets.push(index);
          return frames[index];
        },
      };
      const traj = Trajectory.fromAsyncProvider(provider);

      await traj.frame(0);
      expect(traj.currentIndex).toBe(0);
      expect(gets).toEqual([0]);

      traj.prefetch([1, -1, 99]);
      // Allow microtasks for fire-and-forget loads
      await Promise.resolve();
      await Promise.resolve();
      // Wait for prefetch promise
      await new Promise((r) => setTimeout(r, 0));

      expect(traj.currentIndex).toBe(0);
      expect(gets).toContain(1);
      expect(gets).not.toContain(-1);
      expect(gets).not.toContain(99);
      expect(traj.hasCachedFrame(1)).toBe(true);

      gets.length = 0;
      await traj.frame(1);
      expect(gets).toEqual([]); // cache hit
    });

    it("swallows provider rejection on prefetch", async () => {
      const frames = makeFrames(2);
      const provider = {
        length: frames.length,
        get: async (index: number) => {
          if (index === 1) throw new Error("cancelled");
          return frames[index];
        },
      };
      const traj = Trajectory.fromAsyncProvider(provider);
      await traj.frame(0);
      expect(() => traj.prefetch([1])).not.toThrow();
      await new Promise((r) => setTimeout(r, 0));
      expect(traj.currentIndex).toBe(0);
    });
  });

  describe("fromProvider (lazy)", () => {
    it("should support lazy frame loading", () => {
      const frames = makeFrames(5);
      let reads = 0;
      const provider = {
        length: frames.length,
        get(index: number) {
          reads++;
          return frames[index];
        },
      };
      const traj = Trajectory.fromProvider(provider);
      expect(traj.length).toBe(5);
      expect(traj.currentIndex).toBe(0);
      expect(reads).toBe(0);
      traj.seek(3);
      expect(traj.currentIndex).toBe(3);
      expect(reads).toBe(0);
      expect(traj.currentFrame).toBe(frames[3]);
      expect(reads).toBe(1);
    });

    it("should allow replacing provider-backed frames", () => {
      const frames = makeFrames(3);
      const provider = {
        length: frames.length,
        get(index: number) {
          return frames[index];
        },
      };
      const traj = Trajectory.fromProvider(provider);
      const replacement = new Frame();

      expect(traj.replaceFrame(1, replacement)).toBe(true);
      expect(traj.get(1)).toBe(replacement);
    });
  });

  describe("frameToTrajectory (ac-001..004)", () => {
    it("ac-001: wraps a frame as a length-1 trajectory", () => {
      expect(frameToTrajectory(new Frame()).length).toBe(1);
    });

    it("ac-002: get(0) returns the same frame reference", () => {
      const f = new Frame();
      expect(frameToTrajectory(f).get(0)).toBe(f);
    });

    it("ac-003: the wrapped trajectory is eager (isLazy false)", () => {
      expect(frameToTrajectory(new Frame()).isLazy).toBe(false);
    });

    it("ac-004: block column data round-trips through the wrapper", () => {
      const f = new Frame();
      const atoms = new Block();
      atoms.setColF("x", new Float64Array([1.5, 2.5, 3.5]));
      f.insertBlock("atoms", atoms);
      const out = frameToTrajectory(f).get(0)?.getBlock("atoms");
      expect(out?.nrows()).toBe(3);
      expect(Array.from(out?.copyColF("x") ?? new Float64Array())).toEqual([
        1.5, 2.5, 3.5,
      ]);
    });
  });
});
