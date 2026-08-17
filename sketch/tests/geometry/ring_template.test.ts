import { describe, expect, it } from "@rstest/core";
import { buildRingTemplate } from "../../src/geometry/ring_template";
import { DEFAULT_BOND_LENGTH } from "../../src/geometry/snap";

describe("buildRingTemplate", () => {
  it("hexagon: R = bondLength (RDKit regular n-gon with side = bond)", () => {
    const bl = DEFAULT_BOND_LENGTH;
    const r = buildRingTemplate(6, 0, 0, bl);
    expect(r.vertices).toHaveLength(6);
    expect(r.edges).toHaveLength(6);
    expect(r.radius).toBeCloseTo(bl, 8);
    for (const v of r.vertices) {
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(bl, 8);
    }
    // Edge length ≈ bond length
    const a = r.vertices[0];
    const b = r.vertices[1];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(bl, 6);
  });

  it("benzene shares topology with aliphatic 6", () => {
    const b = buildRingTemplate(6, 0, 0, DEFAULT_BOND_LENGTH, "benzene");
    expect(b.kind).toBe("benzene");
    expect(b.vertices).toHaveLength(6);
  });

  it("rejects size outside 3..8", () => {
    expect(() => buildRingTemplate(2, 0, 0)).toThrow();
  });
});
