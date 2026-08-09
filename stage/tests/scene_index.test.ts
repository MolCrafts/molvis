import { Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { SceneIndex } from "../src/scene_index";

const RING_NORMAL = new Vector3(1, 2, 3).normalize();

/**
 * Put a benzene ring into the edit pool — topology plus atom meta, no meshes.
 * The ring is tilted off every coordinate axis so an axis-derived answer
 * cannot pass by coincidence.
 */
function editPoolBenzene(): { index: SceneIndex; positions: Vector3[] } {
  const index = new SceneIndex();
  const u = Vector3.Cross(RING_NORMAL, new Vector3(0, 0, 1)).normalize();
  const v = Vector3.Cross(RING_NORMAL, u);
  const radius = 1.397;

  const positions: Vector3[] = [];
  for (let k = 0; k < 6; k++) {
    const angle = (k * Math.PI) / 3;
    const c = radius * Math.cos(angle);
    const s = radius * Math.sin(angle);
    const position = new Vector3(
      u.x * c + v.x * s,
      u.y * c + v.y * s,
      u.z * c + v.z * s,
    );
    positions.push(position);
    index.topology.addAtom(k);
    index.metaRegistry.atoms.setEdit(k, {
      type: "atom",
      atomId: k,
      element: "C",
      position: { x: position.x, y: position.y, z: position.z },
    });
  }
  for (let k = 0; k < 6; k++) {
    index.topology.addBond(k, k, (k + 1) % 6);
  }
  return { index, positions };
}

describe("SceneIndex.bondPlaneAxis", () => {
  it("resolves a ring bond's offset axis into the ring plane", () => {
    const { index, positions } = editPoolBenzene();
    const out = new Vector3();

    for (let k = 0; k < 6; k++) {
      const p1 = positions[k];
      const p2 = positions[(k + 1) % 6];
      const dir = p2.subtract(p1).normalize();
      index.bondPlaneAxis(k, p1, (k + 1) % 6, p2, dir, out);

      expect(Vector3.Dot(out, RING_NORMAL)).toBeCloseTo(0, 6);
      expect(Vector3.Dot(out, dir)).toBeCloseTo(0, 6);
      expect(out.length()).toBeCloseTo(1, 6);
    }
  });

  it("uses the endpoint positions passed in, not the stored meta", () => {
    // A drag resolves the axis before the dragged atom's meta is updated, so
    // reading position back from meta would plane the bond off its old spot.
    const { index, positions } = editPoolBenzene();
    const dragged = positions[0].add(RING_NORMAL.scale(2.5));
    const partner = positions[1];
    const dir = partner.subtract(dragged).normalize();
    const out = new Vector3();

    index.bondPlaneAxis(0, dragged, 1, partner, dir, out);

    expect(Vector3.Dot(out, dir)).toBeCloseTo(0, 6);
    // The ring is no longer planar through atom 0, so the axis must have left
    // the original ring plane too.
    expect(Math.abs(Vector3.Dot(out, RING_NORMAL))).toBeGreaterThan(0.01);
  });

  it("falls back to a fixed axis for a lone bond", () => {
    const index = new SceneIndex();
    const p1 = new Vector3(0, 0, 0);
    const p2 = new Vector3(1.2, 0, 0);
    index.topology.addBond(0, 0, 1);
    const dir = p2.subtract(p1).normalize();
    const out = new Vector3();

    index.bondPlaneAxis(0, p1, 1, p2, dir, out);

    expect(Vector3.Dot(out, dir)).toBeCloseTo(0, 6);
    expect(out.length()).toBeCloseTo(1, 6);
  });
});
