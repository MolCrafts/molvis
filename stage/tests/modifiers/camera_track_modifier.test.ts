import { describe, expect, it } from "@rstest/core";
import { CameraTrackModifier } from "../../src/modifiers/CameraTrackModifier";

describe("CameraTrackModifier", () => {
  it("requires at least two keys", () => {
    const mod = new CameraTrackModifier("t1");
    expect(() =>
      mod.setSpec({
        keys: [{ position: [1, 0, 0], target: [0, 0, 0] }],
        duration: 4,
        loop: true,
        rate: 1,
      }),
    ).toThrow(/at least two/);
  });

  it("stores path and timing", () => {
    const mod = new CameraTrackModifier("t2");
    mod.setSpec({
      keys: [
        { position: [1, 0, 0], target: [0, 0, 0] },
        { position: [0, 1, 0], target: [0, 0, 0] },
      ],
      duration: 8,
      loop: true,
      rate: 0.5,
    });
    expect(mod.keys).toHaveLength(2);
    expect(mod.duration).toBe(8);
    expect(mod.loop).toBe(true);
    expect(mod.rate).toBe(0.5);
    expect(mod.isPlaying).toBe(false);
  });

  it("onRemoved is safe when never started", () => {
    const mod = new CameraTrackModifier("t3");
    expect(() => mod.onRemoved()).not.toThrow();
  });

  it("applyVisibility(false) stops without app crash", () => {
    const mod = new CameraTrackModifier("t4");
    mod.setSpec({
      keys: [
        { position: [1, 0, 0], target: [0, 0, 0] },
        { position: [0, 1, 0], target: [0, 0, 0] },
      ],
      duration: 4,
      loop: false,
      rate: 1,
    });
    // No scene bound — stop path only.
    mod.applyVisibility({} as never, false);
    expect(mod.isPlaying).toBe(false);
  });

  it("setDuration / setRate rebuild without throwing", () => {
    const mod = new CameraTrackModifier("t5");
    mod.setSpec({
      keys: [
        { position: [1, 0, 0], target: [0, 0, 0] },
        { position: [0, 1, 0], target: [0, 0, 0] },
      ],
      duration: 4,
      loop: true,
      rate: 1,
    });
    mod.setDuration(10);
    mod.setRate(2);
    expect(mod.duration).toBe(10);
    expect(mod.rate).toBe(2);
  });

  it("stop() keeps the path so a later start can rebuild without setSpec", () => {
    const mod = new CameraTrackModifier("t6");
    mod.setSpec({
      keys: [
        { position: [1, 0, 0], target: [0, 0, 0] },
        { position: [0, 1, 0], target: [0, 0, 0] },
      ],
      duration: 4,
      loop: true,
      rate: 1,
    });
    mod.stop();
    // Path retained after stop (re-enable / applyVisibility path).
    expect(mod.keys).toHaveLength(2);
    expect(mod.isPlaying).toBe(false);
  });
});
