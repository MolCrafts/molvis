import { describe, expect, it } from "@rstest/core";
import { buildChainPoints } from "../../src/geometry/chain_builder";

describe("buildChainPoints", () => {
  it("builds three unit segments with 120-degree internal angles", () => {
    const vertices = [
      { x: 0, y: 0 },
      ...buildChainPoints(0, 0, 3, 0, 1).points,
    ];

    expect(vertices).toHaveLength(4);
    for (let index = 1; index < vertices.length; index++) {
      const previous = vertices[index - 1];
      const current = vertices[index];
      expect(
        Math.hypot(current.x - previous.x, current.y - previous.y),
      ).toBeCloseTo(1, 8);
    }
    for (let index = 1; index < vertices.length - 1; index++) {
      const previous = vertices[index - 1];
      const current = vertices[index];
      const next = vertices[index + 1];
      const ax = previous.x - current.x;
      const ay = previous.y - current.y;
      const bx = next.x - current.x;
      const by = next.y - current.y;
      const cosine =
        (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
      const angleDegrees =
        (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
      expect(angleDegrees).toBeCloseTo(120, 6);
    }
    expect(vertices.some((point) => Math.abs(point.y) > 1e-8)).toBe(true);
  });

  it("returns no points when the drag can make only one segment", () => {
    expect(buildChainPoints(0, 0, 1, 0, 1).points).toEqual([]);
  });
});
