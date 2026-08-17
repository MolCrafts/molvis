import { describe, expect, test } from "@rstest/core";
import { buildTrajectoryLines } from "../../src/algo/trajectory_lines";

describe("buildTrajectoryLines", () => {
  test("samples atom path across frames", () => {
    const frames = [
      { x: [0, 10], y: [0, 0], z: [0, 0] },
      { x: [1, 11], y: [0, 0], z: [0, 0] },
      { x: [2, 12], y: [0, 0], z: [0, 0] },
    ];
    const lines = buildTrajectoryLines(frames, [0], 1);
    expect(lines.length).toBe(1);
    expect(lines[0].path[0]).toBe(0);
    expect(lines[0].path[3]).toBe(1);
    expect(lines[0].path[6]).toBe(2);
  });

  test("frame stride thins path", () => {
    const frames = Array.from({ length: 5 }, (_, i) => ({
      x: [i],
      y: [0],
      z: [0],
    }));
    const lines = buildTrajectoryLines(frames, [0], 2);
    // frames 0,2,4 → 3 samples
    expect(lines[0].path.length / 3).toBe(3);
  });
});
