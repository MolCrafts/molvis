import { Block, Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  expandFrameRange,
  resolveTrackedAtomIndices,
  resolveTrackedAtomSelection,
  runTrajectoryFrames,
} from "../src/analysis/trajectory_runner";
import { Trajectory } from "../src/system/trajectory";

function makeFrame(xs: number[], ids?: number[]): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", Float64Array.from(xs));
  atoms.setColF("y", new Float64Array(xs.length));
  atoms.setColF("z", new Float64Array(xs.length));
  atoms.setColStr(
    "element",
    Array.from({ length: xs.length }, () => "Ar"),
  );
  if (ids) atoms.setColU32("id", Uint32Array.from(ids));
  frame.insertBlock("atoms", atoms);
  return frame;
}

describe("analysis trajectory runner", () => {
  it("expands inclusive frame ranges with stride", () => {
    expect(
      expandFrameRange(10, { start: 2, endInclusive: 8, stride: 3 }),
    ).toEqual([2, 5, 8]);
    expect(expandFrameRange(3, { start: -5, endInclusive: 99 })).toEqual([
      0, 1, 2,
    ]);
    expect(expandFrameRange(5, { start: 4, endInclusive: 1 })).toEqual([]);
  });

  it("tracks selected atoms by stable id columns across row reordering", () => {
    const first = makeFrame([0, 1, 2], [10, 20, 30]);
    const second = makeFrame([2, 0, 1], [30, 10, 20]);
    const tracked = resolveTrackedAtomSelection(first, {
      kind: "indices",
      indices: [1, 2],
    });

    expect(tracked.mode).toBe("id-column");
    expect(tracked.idColumn).toBe("id");

    const resolved = resolveTrackedAtomIndices(second, tracked);
    expect(resolved.ok).toBe(true);
    expect(resolved.indices).toEqual([2, 0]);
  });

  it("fails row-index tracking when topology changes", () => {
    const first = makeFrame([0, 1, 2]);
    const second = makeFrame([0, 1]);
    const tracked = resolveTrackedAtomSelection(first, {
      kind: "indices",
      indices: [1, 2],
    });

    expect(tracked.mode).toBe("row-index");
    const resolved = resolveTrackedAtomIndices(second, tracked);
    expect(resolved.ok).toBe(false);
  });

  it("runs sampled frames without moving trajectory currentIndex", async () => {
    const trajectory = new Trajectory([
      makeFrame([0]),
      makeFrame([1]),
      makeFrame([2]),
      makeFrame([3]),
    ]);
    trajectory.seek(1);

    const seen: number[] = [];
    const result = await runTrajectoryFrames(
      {
        trajectory,
        selection: { kind: "all" },
        run: { frameRange: { start: 0, endInclusive: 3, stride: 2 } },
      },
      ({ frameIndex }) => {
        seen.push(frameIndex);
        return frameIndex * 10;
      },
    );

    expect(trajectory.currentIndex).toBe(1);
    expect(seen).toEqual([0, 2]);
    expect(result.results.map((item) => item.value)).toEqual([0, 20]);
    expect(result.failures).toEqual([]);
  });
});
