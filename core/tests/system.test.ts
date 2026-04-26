import { Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import { EventEmitter, type MolvisEventMap } from "../src/events";
import { System } from "../src/system";
import { Trajectory } from "../src/system/trajectory";

function makeFrames(n: number): Frame[] {
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) {
    frames.push(new Frame());
  }
  return frames;
}

describe("System", () => {
  describe("initialization", () => {
    it("should initialize with an empty frame", () => {
      const system = new System();
      expect(system.trajectory.length).toBe(1);
      expect(system.frame).toBeTruthy();
    });
  });

  describe("trajectory setter", () => {
    it("should emit trajectory-change and frame-change events", () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      const received: string[] = [];

      events.on("trajectory-change", () => received.push("trajectory-change"));
      events.on("frame-change", () => received.push("frame-change"));

      system.trajectory = new Trajectory(makeFrames(5));
      expect(received).toContain("trajectory-change");
      expect(received).toContain("frame-change");
    });
  });

  describe("single-frame trajectory", () => {
    it("wraps a frame as a one-element trajectory via the setter", () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      system.trajectory = new Trajectory([new Frame()]);
      expect(system.trajectory.length).toBe(1);
      expect(system.trajectory.currentIndex).toBe(0);
    });

    it("emits frame-change when the trajectory is swapped", () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      let frameIdx = -1;
      events.on("frame-change", (idx) => {
        frameIdx = idx;
      });
      system.trajectory = new Trajectory([new Frame()]);
      expect(frameIdx).toBe(0);
    });
  });

  describe("navigation", () => {
    it("nextFrame should advance and emit event", async () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      system.trajectory = new Trajectory(makeFrames(3));

      let lastIdx = -1;
      events.on("frame-change", (idx) => {
        lastIdx = idx;
      });

      expect(await system.nextFrame()).toBe(true);
      expect(lastIdx).toBe(1);
      expect(system.trajectory.currentIndex).toBe(1);
    });

    it("nextFrame should return false at end", async () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      system.trajectory = new Trajectory(makeFrames(2));

      await system.nextFrame();
      expect(await system.nextFrame()).toBe(false);
    });

    it("prevFrame should go back and emit event", async () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      system.trajectory = new Trajectory(makeFrames(3));

      await system.nextFrame();
      await system.nextFrame();
      expect(await system.prevFrame()).toBe(true);
      expect(system.trajectory.currentIndex).toBe(1);
    });

    it("prevFrame should return false at start", async () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      system.trajectory = new Trajectory(makeFrames(3));

      expect(await system.prevFrame()).toBe(false);
    });

    it("seekFrame should jump to specific index", async () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      system.trajectory = new Trajectory(makeFrames(10));

      let lastIdx = -1;
      events.on("frame-change", (idx) => {
        lastIdx = idx;
      });

      expect(await system.seekFrame(5)).toBe(true);
      expect(lastIdx).toBe(5);
    });

    it("seekFrame should return false for same index", async () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      system.trajectory = new Trajectory(makeFrames(5));

      expect(await system.seekFrame(0)).toBe(false);
    });

    it("seekFrame should clamp to valid range", async () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      system.trajectory = new Trajectory(makeFrames(5));

      await system.seekFrame(100);
      expect(system.trajectory.currentIndex).toBe(4);
    });
  });

  describe("updateCurrentFrame", () => {
    it("should replace current frame in-place", () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      const frames = makeFrames(3);
      system.trajectory = new Trajectory(frames);

      let emitted = false;
      events.on("frame-change", () => {
        emitted = true;
      });

      const newFrame = new Frame();
      system.updateCurrentFrame(newFrame);
      expect(emitted).toBe(true);
    });
  });
});
