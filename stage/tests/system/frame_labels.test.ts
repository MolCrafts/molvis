import { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import {
  aggregateFrameLabels,
  extendFrameLabels,
} from "../../src/system/frame_labels";
import { Trajectory } from "../../src/system/trajectory";

function makeFrame(meta: Record<string, string>): Frame {
  const frame = new Frame();
  for (const [key, value] of Object.entries(meta)) frame.setMeta(key, value);
  return frame;
}

describe("aggregateFrameLabels", () => {
  it("returns an empty map for an empty trajectory", () => {
    expect(aggregateFrameLabels(new Trajectory([])).size).toBe(0);
  });

  it("surfaces numeric meta as per-frame columns", () => {
    const traj = new Trajectory([
      makeFrame({ energy: "-1.23", temp: "300" }),
      makeFrame({ energy: "-1.50", temp: "310" }),
      makeFrame({ energy: "-1.10", temp: "305" }),
    ]);
    const labels = aggregateFrameLabels(traj);

    expect(labels.get("energy")?.length).toBe(3);
    expect(labels.get("energy")?.[0]).toBeCloseTo(-1.23, 10);
    expect(labels.get("temp")?.[1]).toBeCloseTo(310, 10);
  });

  it("drops purely categorical keys", () => {
    const traj = new Trajectory([
      makeFrame({ energy: "-1.23", config: "trans" }),
      makeFrame({ energy: "-1.50", config: "cis" }),
      makeFrame({ energy: "-1.10", config: "trans" }),
    ]);
    const labels = aggregateFrameLabels(traj);

    expect(labels.has("energy")).toBe(true);
    expect(labels.has("config")).toBe(false);
  });

  it("returns an empty map when no frame carries numeric meta", () => {
    const traj = new Trajectory([new Frame(), new Frame()]);
    expect(aggregateFrameLabels(traj).size).toBe(0);
  });

  it("stores NaN where a frame is missing an otherwise-numeric key", () => {
    const traj = new Trajectory([
      makeFrame({ energy: "-1.23" }),
      makeFrame({ temp: "300" }), // energy missing here
      makeFrame({ energy: "-1.10" }),
    ]);
    const energy = aggregateFrameLabels(traj).get("energy");

    expect(energy?.length).toBe(3);
    expect(energy?.[0]).toBeCloseTo(-1.23, 10);
    expect(Number.isNaN(energy?.[1] ?? 0)).toBe(true);
    expect(energy?.[2]).toBeCloseTo(-1.1, 10);
  });
});

describe("extendFrameLabels", () => {
  function labelsOf(...values: number[][]): Map<string, Float64Array> {
    const traj = new Trajectory(
      values[0].map((_, i) =>
        makeFrame({
          energy: String(values[0][i]),
          temp: String(values[1][i]),
        }),
      ),
    );
    return aggregateFrameLabels(traj);
  }

  it("passes a null table straight through", () => {
    // A live stream that never had labels must not start allocating one.
    expect(extendFrameLabels(null, makeFrame({ energy: "1" }))).toBeNull();
  });

  it("passes an empty table through unchanged", () => {
    const empty = new Map<string, Float64Array>();
    expect(extendFrameLabels(empty, makeFrame({ energy: "1" }))).toBe(empty);
  });

  it("grows every column by exactly one slot", () => {
    const before = labelsOf([1, 2], [300, 310]);
    const after = extendFrameLabels(before, makeFrame({ energy: "3" }));

    expect(after?.get("energy")?.length).toBe(3);
    expect(after?.get("temp")?.length).toBe(3);
  });

  it("reads the appended frame's value for each known key", () => {
    const before = labelsOf([1, 2], [300, 310]);
    const after = extendFrameLabels(
      before,
      makeFrame({ energy: "-7.5", temp: "42" }),
    );

    expect(after?.get("energy")?.[2]).toBeCloseTo(-7.5, 10);
    expect(after?.get("temp")?.[2]).toBeCloseTo(42, 10);
  });

  it("writes NaN where the appended frame has no value for a known key", () => {
    const before = labelsOf([1, 2], [300, 310]);
    const after = extendFrameLabels(before, makeFrame({ energy: "-7.5" }));

    expect(after?.get("energy")?.[2]).toBeCloseTo(-7.5, 10);
    expect(Number.isNaN(after?.get("temp")?.[2] ?? 0)).toBe(true);
  });

  it("writes NaN for every key when there is no frame at all", () => {
    const before = labelsOf([1, 2], [300, 310]);
    const after = extendFrameLabels(before, undefined);

    expect(Number.isNaN(after?.get("energy")?.[2] ?? 0)).toBe(true);
    expect(Number.isNaN(after?.get("temp")?.[2] ?? 0)).toBe(true);
  });

  it("ignores a key seen for the first time on the appended frame", () => {
    // Back-filling it would mean re-reading every earlier frame — the O(N)
    // walk this function exists to avoid. Documented, so asserted.
    const before = labelsOf([1, 2], [300, 310]);
    const after = extendFrameLabels(
      before,
      makeFrame({ energy: "3", pressure: "1.0" }),
    );

    expect(after?.has("pressure")).toBe(false);
  });

  it("does not mutate the table it was given", () => {
    const before = labelsOf([1, 2], [300, 310]);
    const originalEnergy = before.get("energy");

    const after = extendFrameLabels(before, makeFrame({ energy: "3" }));

    expect(originalEnergy?.length).toBe(2);
    expect(after?.get("energy")).not.toBe(originalEnergy);
  });
});
