import { NullEngine, Scene, UniversalCamera, Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { applyPose } from "../../src/camera/pose";
import { TurntableTrack } from "../../src/camera/track";

/**
 * Geometry tests for the analytic turntable track. The whole point of an
 * analytic sample() (vs keyframe-lerp) is that EVERY t lands exactly on the
 * orbit circle — never inside it — so we assert the on-circle invariant at
 * arbitrary t, not just at sampled knots.
 */

const CENTER: [number, number, number] = [1, 2, 3];
const RADIUS = 7;

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Azimuth about the orbit axis (Z-up): angle of (x,y) offset from center.
function azimuth(
  pos: readonly [number, number, number],
  center: readonly [number, number, number],
): number {
  return Math.atan2(pos[1] - center[1], pos[0] - center[0]);
}

describe("TurntableTrack.sample — analytic on-circle invariant (ac-001)", () => {
  const track = new TurntableTrack({
    center: CENTER,
    radius: RADIUS,
    duration: 5,
    revolutions: 1,
  });

  it("lands exactly on the orbit circle for every t, target is center", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const pose = track.sample(t);
      expect(dist(pose.position, CENTER)).toBeCloseTo(RADIUS, 6);
      expect(pose.target[0]).toBeCloseTo(CENTER[0], 6);
      expect(pose.target[1]).toBeCloseTo(CENTER[1], 6);
      expect(pose.target[2]).toBeCloseTo(CENTER[2], 6);
    }
  });
});

describe("TurntableTrack.sample — theta scales with revolutions (ac-002)", () => {
  it("azimuth at fixed t equals 2*PI*revolutions*t", () => {
    const t = 0.125;
    const oneRev = new TurntableTrack({
      center: CENTER,
      radius: RADIUS,
      duration: 5,
      revolutions: 1,
    });
    const ang = azimuth(oneRev.sample(t).position, CENTER);
    // 2*PI*1*0.125 = PI/4
    expect(ang).toBeCloseTo(Math.PI / 4, 6);
  });

  it("doubling revolutions doubles the angular position", () => {
    const t = 0.1;
    const a1 = azimuth(
      new TurntableTrack({
        center: CENTER,
        radius: RADIUS,
        duration: 5,
        revolutions: 1,
      }).sample(t).position,
      CENTER,
    );
    const a2 = azimuth(
      new TurntableTrack({
        center: CENTER,
        radius: RADIUS,
        duration: 5,
        revolutions: 2,
      }).sample(t).position,
      CENTER,
    );
    expect(a2).toBeCloseTo(2 * a1, 6);
  });
});

describe("TurntableTrack.sample — loop closure (ac-003)", () => {
  it("sample(1) equals sample(0) for an integer revolution count", () => {
    const track = new TurntableTrack({
      center: CENTER,
      radius: RADIUS,
      duration: 5,
      revolutions: 3,
    });
    const a = track.sample(0).position;
    const b = track.sample(1).position;
    expect(dist(a, b)).toBeCloseTo(0, 6);
  });
});

describe("applyPose — up/fov inheritance defaults (ac-004)", () => {
  it("leaves camera upVector and fov unchanged when omitted from the pose", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const cam = new UniversalCamera("t", new Vector3(0, 0, 10), scene);
    cam.upVector = new Vector3(0, 0, 1);
    cam.fov = 0.8;

    applyPose(cam, { position: [5, 0, 0], target: [0, 0, 0] });

    expect(cam.upVector.x).toBeCloseTo(0, 6);
    expect(cam.upVector.y).toBeCloseTo(0, 6);
    expect(cam.upVector.z).toBeCloseTo(1, 6);
    expect(cam.fov).toBeCloseTo(0.8, 6);
    // position WAS applied
    expect(cam.position.x).toBeCloseTo(5, 6);

    scene.dispose();
    engine.dispose();
  });

  it("applies up and fov when present", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const cam = new UniversalCamera("t", new Vector3(0, 0, 10), scene);
    cam.fov = 0.8;

    applyPose(cam, {
      position: [5, 0, 0],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fov: 1.1,
    });

    expect(cam.upVector.y).toBeCloseTo(1, 6);
    expect(cam.fov).toBeCloseTo(1.1, 6);

    scene.dispose();
    engine.dispose();
  });
});
