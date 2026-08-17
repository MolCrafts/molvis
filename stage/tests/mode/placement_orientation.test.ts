import { Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "@rstest/core";
import { viewBasis } from "../../src/camera/fit";
import {
  cameraFacingBasis,
  identityPlacementBasis,
  orientLocalOffset,
} from "../../src/mode/placement_orientation";

function mockArcCamera(alpha: number, beta: number) {
  return {
    alpha,
    beta,
  };
}

describe("placement orientation (camera-facing stamp)", () => {
  it("identity basis leaves template axes unchanged", () => {
    const b = identityPlacementBasis();
    const p = orientLocalOffset(2, -1, 0.5, b);
    expect(p.x).toBeCloseTo(2, 6);
    expect(p.y).toBeCloseTo(-1, 6);
    expect(p.z).toBeCloseTo(0.5, 6);
  });

  it("matches viewBasis screen axes for the default iso camera", () => {
    // World default: α=π/4, β=acos(1/√3) — same as World constructor.
    const alpha = Math.PI / 4;
    const beta = Math.acos(1 / Math.sqrt(3));
    const camera = mockArcCamera(alpha, beta);
    const basis = cameraFacingBasis(camera as never);
    const expected = viewBasis(alpha, beta);

    expect(basis.right.x).toBeCloseTo(expected.right[0], 6);
    expect(basis.right.y).toBeCloseTo(expected.right[1], 6);
    expect(basis.right.z).toBeCloseTo(expected.right[2], 6);

    expect(basis.up.x).toBeCloseTo(expected.up[0], 6);
    expect(basis.up.y).toBeCloseTo(expected.up[1], 6);
    expect(basis.up.z).toBeCloseTo(expected.up[2], 6);

    // out = toward viewer = −forward
    expect(basis.out.x).toBeCloseTo(-expected.forward[0], 6);
    expect(basis.out.y).toBeCloseTo(-expected.forward[1], 6);
    expect(basis.out.z).toBeCloseTo(-expected.forward[2], 6);
  });

  it("maps a flat template into the screen plane (face-on)", () => {
    // Camera looking down −Z (from +Z): α any, β=0 → dir=(0,0,1), forward=(0,0,−1).
    // Template XY should land in world XY (screen), z toward +Z (viewer).
    const alpha = 0;
    const beta = 0;
    const camera = mockArcCamera(alpha, beta);
    const basis = cameraFacingBasis(camera as never);

    // Looking from +Z: screen right ≈ +Y or −Y depending on α; out ≈ +Z.
    expect(basis.out.z).toBeCloseTo(1, 5);

    // Flat molecule (lz=0) has no depth along the view axis after orientation:
    // the out component of oriented (lx,ly,0) is 0.
    const p = orientLocalOffset(1, 0, 0, basis);
    const depth = Vector3.Dot(p, basis.out);
    expect(depth).toBeCloseTo(0, 5);

    // Thickness along template +z sticks out toward the viewer.
    const thick = orientLocalOffset(0, 0, 1, basis);
    expect(Vector3.Dot(thick, basis.out)).toBeCloseTo(1, 5);
  });

  it("rotates template +x onto screen-right for a side-looking camera", () => {
    // α=0, β=π/2: dir=(1,0,0) — camera sits on +X looking toward −X.
    const alpha = 0;
    const beta = Math.PI / 2;
    const camera = mockArcCamera(alpha, beta);
    const basis = cameraFacingBasis(camera as never);
    const expected = viewBasis(alpha, beta);

    const bond = orientLocalOffset(2, 0, 0, basis);
    // Should equal 2 * screen-right
    expect(bond.x).toBeCloseTo(2 * expected.right[0], 5);
    expect(bond.y).toBeCloseTo(2 * expected.right[1], 5);
    expect(bond.z).toBeCloseTo(2 * expected.right[2], 5);
  });
});
