import { Frame } from "@molcrafts/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  FrameDataSource,
  TrajectoryDataSource,
} from "../src/pipeline/data_source_modifier";
import { SelectionMask } from "../src/pipeline/types";
import { Trajectory } from "../src/system/trajectory";
import "./setup_wasm";

describe("DataSourceModifier subclasses", () => {
  const makeContext = () => ({
    currentSelection: SelectionMask.all(0),
    selectionSet: new Map<string, SelectionMask>(),
    selectionCache: new Map<string, SelectionMask>(),
    selectedBondIds: [],
    suppressHighlight: false,
    frameIndex: 0,
    app: {} as never,
    postRenderEffects: [],
  });

  it("FrameDataSource.apply is identity (the merge happens in pipeline phase A)", () => {
    const ds = new FrameDataSource(new Frame());
    const frameA = new Frame();
    const frameB = new Frame();
    const ctx = makeContext();

    expect(ds.apply(frameA, ctx)).toBe(frameA);
    expect(ds.apply(frameB, ctx)).toBe(frameB);
  });

  it("TrajectoryDataSource.apply is identity", () => {
    const ds = new TrajectoryDataSource(new Trajectory([new Frame()]));
    const frameA = new Frame();
    expect(ds.apply(frameA, makeContext())).toBe(frameA);
  });

  it("FrameDataSource.frameCount === 1 regardless of pipeline length", () => {
    const ds = new FrameDataSource(new Frame());
    expect(ds.frameCount).toBe(1);
  });

  it("TrajectoryDataSource.frameCount mirrors the wrapped trajectory", () => {
    const traj = new Trajectory([new Frame(), new Frame(), new Frame()]);
    const ds = new TrajectoryDataSource(traj);
    expect(ds.frameCount).toBe(3);
  });

  it("FrameDataSource.getFrame ignores its index argument (broadcast)", () => {
    const frame = new Frame();
    const ds = new FrameDataSource(frame);
    expect(ds.getFrame(0)).toBe(frame);
    expect(ds.getFrame(42)).toBe(frame);
    expect(ds.getFrame(99999)).toBe(frame);
  });

  it("TrajectoryDataSource.getFrame resolves the index-th frame", async () => {
    const f0 = new Frame();
    const f1 = new Frame();
    const traj = new Trajectory([f0, f1]);
    const ds = new TrajectoryDataSource(traj);
    expect(await ds.getFrame(0)).toBe(f0);
    expect(await ds.getFrame(1)).toBe(f1);
  });

  it("preload throws on out-of-range index for TrajectoryDataSource", async () => {
    const traj = new Trajectory([new Frame()]);
    const ds = new TrajectoryDataSource(traj);
    await expect(ds.preload(5)).rejects.toThrow(/out of range/);
  });

  it("cachedFrame on TrajectoryDataSource throws before preload", () => {
    const traj = new Trajectory([new Frame()]);
    const ds = new TrajectoryDataSource(traj);
    expect(() => ds.cachedFrame).toThrow(/preload/);
  });

  it("cachedFrame on FrameDataSource is always available (no preload required)", () => {
    const frame = new Frame();
    const ds = new FrameDataSource(frame);
    expect(ds.cachedFrame).toBe(frame);
  });

  it("DataSourceOptions populate sourceType / filename / contributedBlocks", () => {
    const ds = new FrameDataSource(new Frame(), {
      sourceType: "file",
      filename: "topology.data",
      contributedBlocks: ["bonds"],
    });
    expect(ds.sourceType).toBe("file");
    expect(ds.filename).toBe("topology.data");
    expect(ds.contributedBlocks).toEqual(["bonds"]);
  });
});
