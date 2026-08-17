import { Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import {
  intersectRayWithPlane,
  screenAlignedPlaneNormal,
  screenAlignedPlaneOrigin,
} from "../../src/mode/placement_position";

function mockCamera(options: {
  forward: Vector3;
  target?: Vector3;
  position?: Vector3;
}) {
  return {
    getDirection: (dir: Vector3) => {
      // Babylon Vector3.Forward() is (0,0,1); we only care about the axis used.
      if (dir.z === 1 && dir.x === 0 && dir.y === 0) {
        return options.forward.clone();
      }
      return dir.clone();
    },
    target: options.target,
    position: options.position ?? new Vector3(0, 0, -10),
  };
}

describe("placement position (pointer → space)", () => {
  describe("screenAlignedPlaneNormal", () => {
    it("is opposite the camera forward", () => {
      const camera = mockCamera({
        forward: new Vector3(0, 0, 1),
      });
      const n = screenAlignedPlaneNormal(camera as never);
      expect(n.x).toBeCloseTo(0, 6);
      expect(n.y).toBeCloseTo(0, 6);
      expect(n.z).toBeCloseTo(-1, 6);
      expect(n.length()).toBeCloseTo(1, 6);
    });
  });

  describe("screenAlignedPlaneOrigin", () => {
    it("prefers an explicit anchor (drag / attach plane)", () => {
      const camera = mockCamera({
        forward: new Vector3(0, 0, 1),
        target: new Vector3(0, 0, 0),
      });
      const anchor = new Vector3(3, 4, 5);
      const o = screenAlignedPlaneOrigin(camera as never, anchor);
      expect(o.x).toBe(3);
      expect(o.y).toBe(4);
      expect(o.z).toBe(5);
    });

    it("falls back to camera target for empty-canvas place", () => {
      const camera = mockCamera({
        forward: new Vector3(0, 0, 1),
        target: new Vector3(1, 2, 3),
      });
      const o = screenAlignedPlaneOrigin(camera as never);
      expect(o.x).toBe(1);
      expect(o.y).toBe(2);
      expect(o.z).toBe(3);
    });
  });

  describe("intersectRayWithPlane", () => {
    it("hits the plane along a forward ray (click under camera)", () => {
      // Plane z = 0, normal +Z; ray from z=-10 toward +Z.
      const hit = intersectRayWithPlane(
        new Vector3(2, -1, -10),
        new Vector3(0, 0, 1),
        new Vector3(0, 0, 0),
        new Vector3(0, 0, 1),
      );
      expect(hit).not.toBeNull();
      expect(hit!.x).toBeCloseTo(2, 6);
      expect(hit!.y).toBeCloseTo(-1, 6);
      expect(hit!.z).toBeCloseTo(0, 6);
    });

    it("returns null when ray is parallel to the plane", () => {
      const hit = intersectRayWithPlane(
        new Vector3(0, 0, -5),
        new Vector3(1, 0, 0),
        new Vector3(0, 0, 0),
        new Vector3(0, 0, 1),
      );
      expect(hit).toBeNull();
    });

    it("matches empty-canvas atom / molecule place geometry", () => {
      // Camera looks +Z; plane through target; pointer ray slightly off-axis.
      const planeOrigin = new Vector3(0, 0, 0);
      const planeNormal = new Vector3(0, 0, -1); // toward camera
      const rayOrigin = new Vector3(0, 0, -8);
      const rayDir = new Vector3(0.1, -0.05, 1).normalize();
      const hit = intersectRayWithPlane(
        rayOrigin,
        rayDir,
        planeOrigin,
        planeNormal,
      );
      expect(hit).not.toBeNull();
      // Hit lies on the plane (z ≈ 0).
      expect(hit!.z).toBeCloseTo(0, 5);
      // And is offset in x/y from the optical center — click maps to space.
      expect(hit!.x).not.toBeCloseTo(0, 2);
      expect(hit!.y).not.toBeCloseTo(0, 2);
    });
  });
});
