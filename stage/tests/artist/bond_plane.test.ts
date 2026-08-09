import { Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import {
  type AtomCoords,
  BondPlaneAxis,
  BondPlaneFrame,
} from "../../src/artist/bond_plane";

const RING_NORMAL = new Vector3(1, 2, 3).normalize();

/**
 * Regular hexagon of C–C = 1.397 Å, atom k at 60k°, in a plane aligned with no
 * coordinate axis — a ring in z = 0 would also satisfy an axis-derived
 * perpendicular and prove nothing.
 */
function benzeneRing(): AtomCoords {
  const u = Vector3.Cross(RING_NORMAL, new Vector3(0, 0, 1)).normalize();
  const v = Vector3.Cross(RING_NORMAL, u);
  const radius = 1.397;
  const x: number[] = [];
  const y: number[] = [];
  const z: number[] = [];
  for (let k = 0; k < 6; k++) {
    const angle = (k * Math.PI) / 3;
    const c = radius * Math.cos(angle);
    const s = radius * Math.sin(angle);
    x.push(u.x * c + v.x * s);
    y.push(u.y * c + v.y * s);
    z.push(u.z * c + v.z * s);
  }
  return { x, y, z };
}

const RING_BONDS_I = new Uint32Array([0, 1, 2, 3, 4, 5]);
const RING_BONDS_J = new Uint32Array([1, 2, 3, 4, 5, 0]);

function bondDirection(coords: AtomCoords, i: number, j: number): Vector3 {
  return new Vector3(
    coords.x[j] - coords.x[i],
    coords.y[j] - coords.y[i],
    coords.z[j] - coords.z[i],
  ).normalize();
}

describe("BondPlaneAxis", () => {
  it("spans the plane of the strongest off-axis neighbor", () => {
    const axis = new BondPlaneAxis();
    const out = new Vector3();

    axis.reset(new Vector3(1, 0, 0));
    axis.offer(-0.7, 0.3, 0); // weakly off-axis
    axis.offer(-0.7, 0, 1.2); // strongly off-axis — wins
    axis.resolve(out);

    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(1, 6);
  });

  it("falls back to a fixed axis when nothing is offered", () => {
    const axis = new BondPlaneAxis();
    const out = new Vector3();

    axis.reset(new Vector3(1, 0, 0));
    axis.resolve(out);

    expect(Vector3.Dot(out, new Vector3(1, 0, 0))).toBeCloseTo(0, 6);
    expect(out.length()).toBeCloseTo(1, 6);
  });

  it("keeps the fallback perpendicular for a bond along the reference axis", () => {
    // dir ∥ ẑ: crossing with ẑ would collapse, so x̂ takes over.
    const axis = new BondPlaneAxis();
    const out = new Vector3();

    axis.reset(new Vector3(0, 0, 1));
    axis.resolve(out);

    expect(Vector3.Dot(out, new Vector3(0, 0, 1))).toBeCloseTo(0, 6);
    expect(out.length()).toBeCloseTo(1, 6);
  });

  it("ignores collinear and far-away candidates", () => {
    const axis = new BondPlaneAxis();
    const out = new Vector3();

    axis.reset(new Vector3(1, 0, 0));
    axis.offer(-1.2, 0, 0); // collinear
    axis.offer(0, 50, 0); // a periodic image, a whole cell away
    axis.resolve(out);

    // Neither was usable, so this is the fixed-axis answer.
    expect(out.z).toBeCloseTo(0, 6);
    expect(Math.abs(out.y)).toBeCloseTo(1, 6);
  });
});

describe("BondPlaneFrame.perpendicular", () => {
  it("returns an in-plane axis for every bond of a flat ring", () => {
    const coords = benzeneRing();
    const frame = BondPlaneFrame.build(RING_BONDS_I, RING_BONDS_J, 6);
    const out = new Vector3();

    for (let b = 0; b < 6; b++) {
      const i = RING_BONDS_I[b];
      const j = RING_BONDS_J[b];
      const dir = bondDirection(coords, i, j);
      frame.perpendicular(i, j, dir, coords, out);
      // Zero projection onto the ring normal == the axis lies in the ring.
      expect(Vector3.Dot(out, RING_NORMAL)).toBeCloseTo(0, 6);
      expect(Vector3.Dot(out, dir)).toBeCloseTo(0, 6);
      expect(out.length()).toBeCloseTo(1, 6);
    }
  });

  it("picks the same plane whichever endpoint is named first", () => {
    const coords = benzeneRing();
    const frame = BondPlaneFrame.build(RING_BONDS_I, RING_BONDS_J, 6);
    const forward = new Vector3();
    const reverse = new Vector3();

    const dir = bondDirection(coords, 0, 1);
    frame.perpendicular(0, 1, dir, coords, forward);
    frame.perpendicular(1, 0, dir, coords, reverse);

    // Reversing the endpoints may flip the sign but must keep the plane.
    expect(Math.abs(Vector3.Dot(forward, reverse))).toBeCloseTo(1, 6);
  });

  it("falls back to a fixed axis for an isolated diatomic", () => {
    const coords: AtomCoords = { x: [0, 1.2], y: [0, 0], z: [0, 0] };
    const frame = BondPlaneFrame.build(
      new Uint32Array([0]),
      new Uint32Array([1]),
      2,
    );
    const dir = new Vector3(1, 0, 0);
    const out = new Vector3();

    frame.perpendicular(0, 1, dir, coords, out);

    expect(Vector3.Dot(out, dir)).toBeCloseTo(0, 6);
    expect(out.length()).toBeCloseTo(1, 6);
  });

  it("falls back to a fixed axis for a linear fragment", () => {
    // H–C≡C–H: every neighbor is collinear with the bond it would describe.
    const coords: AtomCoords = {
      x: [-1.06, 0, 1.2, 2.26],
      y: [0, 0, 0, 0],
      z: [0, 0, 0, 0],
    };
    const frame = BondPlaneFrame.build(
      new Uint32Array([0, 1, 2]),
      new Uint32Array([1, 2, 3]),
      4,
    );
    const dir = new Vector3(1, 0, 0);
    const out = new Vector3();

    frame.perpendicular(1, 2, dir, coords, out);

    expect(Vector3.Dot(out, dir)).toBeCloseTo(0, 6);
    expect(out.length()).toBeCloseTo(1, 6);
  });

  it("resolves from the far endpoint when the near one has no substituent", () => {
    // Carbonyl shape: the O has no substituent, the C carries the plane.
    const coords: AtomCoords = {
      x: [0, 1.23, -0.75],
      y: [0, 0, 1.3],
      z: [0, 0, 0],
    };
    const frame = BondPlaneFrame.build(
      new Uint32Array([0, 0]),
      new Uint32Array([1, 2]),
      3,
    );
    const out = new Vector3();

    // Named O-first, so only the second scan (the carbon) can find a plane.
    frame.perpendicular(1, 0, new Vector3(-1, 0, 0), coords, out);

    expect(out.z).toBeCloseTo(0, 6);
    expect(Math.abs(out.y)).toBeCloseTo(1, 6);
  });
});
