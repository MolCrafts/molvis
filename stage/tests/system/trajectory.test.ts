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
      expect(() => frames[0].keys()).toThrow();
    });

    it("does not free frames listed in the exclude set", () => {
      const frames = makeFrames(2);
      const keep = frames[1];
      const traj = new Trajectory(frames);
      traj.dispose(new Set([keep]));
      // The excluded frame is still alive and usable.
      expect(() => keep.keys()).not.toThrow();
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
      expect(() => frames[0].keys()).not.toThrow();
    });
  });

  describe("dropOldestFrame", () => {
    it("does not free the evicted frame — consumers may still hold it", () => {
      const frames = makeFrames(3);
      const traj = new Trajectory(frames);
      const evicted = frames[0];

      expect(traj.dropOldestFrame()).toBe(true);
      expect(traj.length).toBe(2);
      // The canvas (SceneIndex / Artist / AtomSource) can still be bound to
      // the evicted frame when a live stream trims its head. Freeing here
      // races those consumers exactly as the async LRU comment describes,
      // so eviction must only drop the reference.
      expect(() => evicted.keys()).not.toThrow();
    });

    it("shifts indices down and keeps currentIndex on the same frame", () => {
      const frames = makeFrames(3);
      const traj = new Trajectory(frames);
      traj.seek(2);

      expect(traj.dropOldestFrame()).toBe(true);
      expect(traj.currentIndex).toBe(1);
      expect(traj.currentFrame).toBe(frames[2]);
    });

    it("returns false when there is nothing to drop", () => {
      expect(new Trajectory([]).dropOldestFrame()).toBe(false);
    });

    it("returns false for provider-backed trajectories", () => {
      const frames = makeFrames(2);
      const traj = Trajectory.fromProvider({
        length: frames.length,
        get: (index: number) => frames[index],
      });
      expect(traj.dropOldestFrame()).toBe(false);
      expect(traj.length).toBe(2);
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

  describe("three-component index", () => {
    it("keeps eager length, indexedLength, and indexComplete in sync", () => {
      const traj = new Trajectory(makeFrames(3));
      expect(traj.length).toBe(3);
      expect(traj.indexedLength).toBe(3);
      expect(traj.indexComplete).toBe(true);
    });

    it("does not grow length while recording a file scan", () => {
      const traj = Trajectory.fromAsyncProvider({
        get: async () => new Frame(),
      });
      expect(traj.length).toBeNull();
      expect(traj.indexedLength).toBe(0);
      expect(traj.indexComplete).toBe(false);
      traj.recordIndexedLength(1);
      expect(traj.length).toBeNull();
      expect(traj.indexedLength).toBe(1);
    });

    it("clamps seek to indexedLength even when a larger N is known", () => {
      const traj = Trajectory.fromAsyncProvider({
        get: async () => new Frame(),
      });
      traj.recordIndexedLength(1, 4);
      expect(traj.length).toBe(4);
      expect(traj.indexedLength).toBe(1);
      traj.seek(5);
      expect(traj.currentIndex).toBe(0);
    });

    it("requireCompleteLength throws until markIndexComplete", () => {
      const traj = Trajectory.fromAsyncProvider({
        get: async () => new Frame(),
      });
      traj.recordIndexedLength(1);
      expect(() => traj.requireCompleteLength("analysis")).toThrow(/analysis/);
      traj.markIndexComplete();
      expect(traj.length).toBe(1);
      expect(traj.indexComplete).toBe(true);
      expect(traj.requireCompleteLength("analysis")).toBe(1);
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
      atoms.set("x", new Float64Array([1.5, 2.5, 3.5]));
      f.set("atoms", atoms);
      const out = frameToTrajectory(f).get(0)!.get("atoms");
      expect(out.nRows).toBe(3);
      expect(Array.from(out.copy("x") as Float64Array)).toEqual([
        1.5, 2.5, 3.5,
      ]);
    });
  });
});

describe("Trajectory.sectionUpdates (store index seam)", () => {
  it("is undefined for eager trajectories and out-of-range indices", () => {
    const traj = new Trajectory(makeFrames(2));
    expect(traj.sectionUpdates(0)).toBeUndefined();
    expect(traj.sectionUpdates(-1)).toBeUndefined();
    expect(traj.sectionUpdates(5)).toBeUndefined();
  });

  it("delegates to a sync provider and goes dark for a replaced slot", () => {
    const frames = makeFrames(3);
    const asked: number[] = [];
    const traj = Trajectory.fromProvider({
      length: 3,
      get: (i) => frames[i],
      sectionUpdates: (i) => {
        asked.push(i);
        return new Map([
          ["atoms", i],
          ["bonds", 0],
        ]);
      },
    });
    expect(traj.sectionUpdates(2)?.get("atoms")).toBe(2);
    expect(traj.sectionUpdates(2)?.get("bonds")).toBe(0);
    expect(traj.sectionUpdates(3)).toBeUndefined();
    traj.replaceFrame(2, new Frame());
    expect(traj.sectionUpdates(2)).toBeUndefined();
    expect(asked).toEqual([2, 2]);
  });

  it("is undefined when the provider has no index", () => {
    const frames = makeFrames(1);
    const traj = Trajectory.fromProvider({ length: 1, get: (i) => frames[i] });
    expect(traj.sectionUpdates(0)).toBeUndefined();
  });

  it("delegates to an async provider synchronously", async () => {
    const frame = new Frame();
    const traj = Trajectory.fromAsyncProvider({
      length: 2,
      get: async () => frame,
      sectionUpdates: (i) => (i === 1 ? new Map([["atoms", 9]]) : undefined),
    });
    expect(traj.sectionUpdates(1)?.get("atoms")).toBe(9);
    expect(traj.sectionUpdates(0)).toBeUndefined();
    traj.replaceFrame(1, new Frame());
    expect(traj.sectionUpdates(1)).toBeUndefined();
    expect(traj.get(1)).not.toBe(frame);
  });
});
