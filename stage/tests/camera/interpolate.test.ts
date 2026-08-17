import { describe, expect, it } from "@rstest/core";
import {
  catmullRomVec3,
  interpolatePose,
  lerpVec3,
  slerpVec3,
} from "../../src/camera/interpolate";
import type { CameraPose } from "../../src/camera/pose";
import { KeyframeTrack } from "../../src/camera/track";

describe("lerpVec3 / catmullRomVec3 / slerpVec3", () => {
  it("lerp midpoints", () => {
    expect(lerpVec3([0, 0, 0], [2, 4, 6], 0.5)).toEqual([1, 2, 3]);
  });

  it("catmull-rom at t=0 and t=1 returns segment endpoints", () => {
    const p0: [number, number, number] = [0, 0, 0];
    const p1: [number, number, number] = [1, 0, 0];
    const p2: [number, number, number] = [2, 0, 0];
    const p3: [number, number, number] = [3, 0, 0];
    expect(catmullRomVec3(p0, p1, p2, p3, 0)[0]).toBeCloseTo(1, 6);
    expect(catmullRomVec3(p0, p1, p2, p3, 1)[0]).toBeCloseTo(2, 6);
  });

  it("slerp preserves unit length for orthogonal axes", () => {
    const out = slerpVec3([1, 0, 0], [0, 1, 0], 0.5);
    expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(1, 6);
  });
});

describe("KeyframeTrack", () => {
  const poseA: CameraPose = {
    position: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 0, 1],
  };
  const poseB: CameraPose = {
    position: [10, 0, 10],
    target: [0, 0, 0],
    up: [0, 0, 1],
  };
  const poseC: CameraPose = {
    position: [10, 10, 10],
    target: [0, 0, 0],
    up: [0, 0, 1],
  };

  it("samples endpoints exactly", () => {
    const track = new KeyframeTrack({
      duration: 4,
      keyframes: [
        { t: 0, pose: poseA },
        { t: 1, pose: poseB },
      ],
    });
    expect(track.sample(0).position[0]).toBeCloseTo(0, 6);
    expect(track.sample(1).position[0]).toBeCloseTo(10, 6);
  });

  it("interpolates between keys", () => {
    const track = new KeyframeTrack({
      duration: 4,
      keyframes: [
        { t: 0, pose: poseA },
        { t: 0.5, pose: poseB },
        { t: 1, pose: poseC },
      ],
    });
    const mid = track.sample(0.25);
    // Halfway through A→B: x around 5
    expect(mid.position[0]).toBeGreaterThan(0);
    expect(mid.position[0]).toBeLessThan(10);
  });

  it("rejects fewer than two keys", () => {
    expect(
      () =>
        new KeyframeTrack({
          duration: 1,
          keyframes: [{ t: 0, pose: poseA }],
        }),
    ).toThrow(/two keyframes/);
  });

  it("interpolatePose without neighbors is linear", () => {
    const p = interpolatePose(poseA, poseB, 0.5);
    expect(p.position[0]).toBeCloseTo(5, 6);
  });
});
