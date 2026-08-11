import { Quaternion, Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import {
  eulerDegreesToQuaternion,
  quaternionToEulerDegrees,
  rotateAroundPivot,
  rotatePointsAroundPivot,
  selectionCentroid,
  translatePoints,
} from "../../src/mode/selection_transform";

describe("selection_transform", () => {
  describe("selectionCentroid", () => {
    it("returns null for an empty set", () => {
      expect(selectionCentroid([])).toBeNull();
    });

    it("averages coordinates", () => {
      const c = selectionCentroid([
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 4, z: 6 },
      ]);
      expect(c).toEqual({ x: 1, y: 2, z: 3 });
    });
  });

  describe("translatePoints", () => {
    it("shifts every point by the same delta", () => {
      const out = translatePoints(
        [
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
        { x: 10, y: -1, z: 0.5 },
      );
      expect(out[0]).toEqual({ x: 11, y: -1, z: 0.5 });
      expect(out[1]).toEqual({ x: 10, y: 0, z: 0.5 });
    });
  });

  describe("rotateAroundPivot", () => {
    it("rotates 90° about Z around the origin", () => {
      const q = Quaternion.FromEulerAngles(0, 0, Math.PI / 2);
      const p = rotateAroundPivot(
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        q,
      );
      expect(p.x).toBeCloseTo(0, 5);
      expect(p.y).toBeCloseTo(1, 5);
      expect(p.z).toBeCloseTo(0, 5);
    });

    it("rotates about a non-origin pivot (selection centroid)", () => {
      // Point at (2,0,0), pivot at (1,0,0) → local (1,0,0).
      // 180° about Z → local (−1,0,0) → world (0,0,0).
      const q = Quaternion.FromEulerAngles(0, 0, Math.PI);
      const p = rotateAroundPivot(
        { x: 2, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        q,
      );
      expect(p.x).toBeCloseTo(0, 5);
      expect(p.y).toBeCloseTo(0, 5);
      expect(p.z).toBeCloseTo(0, 5);
    });

    it("keeps the pivot atom fixed under any rotation", () => {
      const pivot = { x: 3, y: -1, z: 2 };
      const q = eulerDegreesToQuaternion(30, -45, 90);
      const p = rotateAroundPivot(pivot, pivot, q);
      expect(p.x).toBeCloseTo(pivot.x, 6);
      expect(p.y).toBeCloseTo(pivot.y, 6);
      expect(p.z).toBeCloseTo(pivot.z, 6);
    });
  });

  describe("rotatePointsAroundPivot", () => {
    it("rigidly rotates a pair (relative distance preserved)", () => {
      const points = [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ];
      const pivot = selectionCentroid(points)!;
      const q = eulerDegreesToQuaternion(0, 0, 90);
      const out = rotatePointsAroundPivot(points, pivot, q);
      const dx = out[1].x - out[0].x;
      const dy = out[1].y - out[0].y;
      const dz = out[1].z - out[0].z;
      const dist = Math.hypot(dx, dy, dz);
      expect(dist).toBeCloseTo(2, 5);
      // 90° Z: bond was along +x from centroid → along +y.
      expect(dx).toBeCloseTo(0, 5);
      expect(dy).toBeCloseTo(2, 5);
      expect(dz).toBeCloseTo(0, 5);
    });
  });

  describe("eulerDegreesToQuaternion / quaternionToEulerDegrees", () => {
    it("round-trips simple XYZ degrees", () => {
      const q = eulerDegreesToQuaternion(10, -20, 30);
      const e = quaternionToEulerDegrees(q);
      expect(e.x).toBeCloseTo(10, 4);
      expect(e.y).toBeCloseTo(-20, 4);
      expect(e.z).toBeCloseTo(30, 4);
    });

    it("matches Babylon FromEulerAngles radians", () => {
      const deg = { x: 45, y: 0, z: 0 };
      const q = eulerDegreesToQuaternion(deg.x, deg.y, deg.z);
      const ref = Quaternion.FromEulerAngles((45 * Math.PI) / 180, 0, 0);
      expect(q.x).toBeCloseTo(ref.x, 6);
      expect(q.y).toBeCloseTo(ref.y, 6);
      expect(q.z).toBeCloseTo(ref.z, 6);
      expect(q.w).toBeCloseTo(ref.w, 6);
    });
  });

  describe("Vector3.applyRotationQuaternion smoke", () => {
    it("agrees with rotateAroundPivot at origin", () => {
      const q = Quaternion.FromEulerAngles(0, Math.PI / 2, 0);
      const viaHelper = rotateAroundPivot(
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 0 },
        q,
      );
      const viaBabylon = new Vector3(0, 0, 1).applyRotationQuaternion(q);
      expect(viaHelper.x).toBeCloseTo(viaBabylon.x, 6);
      expect(viaHelper.y).toBeCloseTo(viaBabylon.y, 6);
      expect(viaHelper.z).toBeCloseTo(viaBabylon.z, 6);
    });
  });
});
