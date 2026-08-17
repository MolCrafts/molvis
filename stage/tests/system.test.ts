import { Frame } from "@molcrafts/molvis-core/molrs";
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

  describe("exploration / frame-labels slots", () => {
    it("identity-guards the setters", () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      let labelEmits = 0;
      events.on("frame-labels-change", () => labelEmits++);

      system.setFrameLabels(null); // already null — no emit
      expect(labelEmits).toBe(0);

      const labels = new Map<string, Float64Array>();
      system.setFrameLabels(labels);
      system.setFrameLabels(labels); // same identity — no second emit
      expect(labelEmits).toBe(1);
    });

    it("invalidates exploration and rebuilds frameLabels before trajectory-change", () => {
      const events = new EventEmitter<MolvisEventMap>();
      const system = new System(events);
      // Seed a (minimal) exploration so the swap has something to clear.
      system.setExploration({} as never);

      const order: string[] = [];
      events.on("frame-labels-change", () => order.push("frame-labels-change"));
      events.on("exploration-change", () => order.push("exploration-change"));
      events.on("trajectory-change", () => order.push("trajectory-change"));

      system.trajectory = new Trajectory(makeFrames(3));

      expect(system.exploration).toBe(null);
      expect(system.frameLabels).not.toBe(null);
      expect(order.indexOf("frame-labels-change")).toBeLessThan(
        order.indexOf("trajectory-change"),
      );
      expect(order.indexOf("exploration-change")).toBeLessThan(
        order.indexOf("trajectory-change"),
      );
    });
  });
});

describe("System.appendFrame", () => {
  function labelledFrame(energy: number): Frame {
    const frame = new Frame();
    frame.setMeta("energy", String(energy));
    return frame;
  }

  it("returns the index of the frame it appended", () => {
    const system = new System();
    system.trajectory = new Trajectory(makeFrames(3));

    expect(system.appendFrame(new Frame())).toBe(3);
    expect(system.appendFrame(new Frame())).toBe(4);
    expect(system.trajectory.length).toBe(5);
  });

  it("emits trajectory-change so the timeline learns the new length", () => {
    const events = new EventEmitter<MolvisEventMap>();
    const system = new System(events);
    let seen: number | null = null;
    events.on("trajectory-change", (traj) => {
      seen = traj.length;
    });

    system.appendFrame(new Frame());

    expect(seen).toBe(2);
  });

  it("does not emit frame-change — the playhead has not moved", () => {
    // The trajectory setter emits both. Append must not, or every arriving
    // frame would look like a navigation to every listener.
    const events = new EventEmitter<MolvisEventMap>();
    const system = new System(events);
    let frameChanges = 0;
    events.on("frame-change", () => {
      frameChanges += 1;
    });

    system.appendFrame(new Frame());

    expect(frameChanges).toBe(0);
  });

  it("leaves the current index and rendered frame alone", async () => {
    const system = new System();
    system.trajectory = new Trajectory(makeFrames(4));
    await system.seekFrame(2);
    const parked = system.frame;

    system.appendFrame(new Frame());

    expect(system.trajectory.currentIndex).toBe(2);
    expect(system.frame).toBe(parked);
  });

  it("keeps frame labels index-aligned with the trajectory", () => {
    // A label column shorter than the trajectory reads as `undefined` at the
    // playhead — a silently wrong descriptor rather than a missing one.
    const system = new System();
    system.trajectory = new Trajectory([labelledFrame(-1), labelledFrame(-2)]);
    expect(system.frameLabels?.get("energy")?.length).toBe(2);

    system.appendFrame(labelledFrame(-3));

    const energy = system.frameLabels?.get("energy");
    expect(energy?.length).toBe(3);
    expect(energy?.[2]).toBeCloseTo(-3, 10);
  });

  it("invalidates an exploration that no longer covers every frame", () => {
    const system = new System();
    system.setExploration({} as never);
    expect(system.exploration).not.toBeNull();

    system.appendFrame(new Frame());

    expect(system.exploration).toBeNull();
  });
});
