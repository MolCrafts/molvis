import { Quaternion, Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { faceCameraToRef } from "../../src/gizmo/axis_helper";

const Z_UP = new Vector3(0, 0, 1);
const LOCAL_FRONT = new Vector3(0, 0, -1);
const LOCAL_UP = new Vector3(0, 1, 0);

/** Camera poses around a +X label tip, including one near the Z pole. */
const CASES: Array<{ name: string; label: Vector3; cam: Vector3 }> = [
  {
    name: "iso octant",
    label: new Vector3(1, 0, 0),
    cam: new Vector3(5, 5, 5),
  },
  { name: "behind", label: new Vector3(1, 0, 0), cam: new Vector3(-4, -3, 2) },
  {
    name: "Z tip, near pole",
    label: new Vector3(0, 0, 1),
    cam: new Vector3(0.01, 0, 9),
  },
  {
    name: "Y tip, below",
    label: new Vector3(0, 1, 0),
    cam: new Vector3(3, -6, -4),
  },
];

describe("faceCameraToRef", () => {
  for (const { name, label, cam } of CASES) {
    it(`turns the plane front (local -Z) at the camera: ${name}`, () => {
      const q = new Quaternion();
      expect(faceCameraToRef(label, cam, Z_UP, q)).toBe(true);

      const toCamera = cam.subtract(label).normalize();
      const front = LOCAL_FRONT.applyRotationQuaternion(q);
      expect(front.x).toBeCloseTo(toCamera.x, 5);
      expect(front.y).toBeCloseTo(toCamera.y, 5);
      expect(front.z).toBeCloseTo(toCamera.z, 5);

      // A unit rotation: the glyph keeps its size.
      expect(q.length()).toBeCloseTo(1, 6);
      // Upright: local +Y stays perpendicular to the view line.
      expect(
        Vector3.Dot(LOCAL_UP.applyRotationQuaternion(q), toCamera),
      ).toBeCloseTo(0, 5);
    });
  }

  it("keeps the label upright along camera up when it can", () => {
    const q = new Quaternion();
    faceCameraToRef(new Vector3(1, 0, 0), new Vector3(8, 0, 0), Z_UP, q);
    const up = LOCAL_UP.applyRotationQuaternion(q);
    expect(up.z).toBeCloseTo(1, 5);
  });

  it("leaves the rotation alone when the label sits on the camera", () => {
    const q = new Quaternion(0, 0, 0, 1);
    const at = new Vector3(1, 2, 3);
    expect(faceCameraToRef(at, at.clone(), Z_UP, q)).toBe(false);
    expect(q.w).toBe(1);
  });
});
