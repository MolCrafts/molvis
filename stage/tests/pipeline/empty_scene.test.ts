import { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { MemoryDataSource } from "../../src/pipeline/data_source";
import {
  createEmptyPrimaryDataSource,
  EMPTY_SCENE_FILENAME,
  ensurePrimaryDataSource,
  installEmptyPrimaryScene,
  primaryDataSource,
} from "../../src/pipeline/empty_scene";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import { System } from "../../src/system";
import { Trajectory } from "../../src/system/trajectory";

describe("empty_scene single-path invariant", () => {
  it("createEmptyPrimaryDataSource is a length-1 empty memory source", () => {
    const ds = createEmptyPrimaryDataSource();
    expect(ds).toBeInstanceOf(MemoryDataSource);
    expect(ds.sourceType).toBe("empty");
    expect(ds.filename).toBe(EMPTY_SCENE_FILENAME);
    expect(ds.frameCount).toBe(1);
    expect(ds.frame.getBlock("atoms")).toBeUndefined();
    ds.dispose();
  });

  it("installEmptyPrimaryScene binds system + pipeline to the same trajectory", () => {
    const system = new System();
    const pipeline = new ModifierPipeline();
    // Pre-existing junk that must be cleared.
    pipeline.addSource(
      new MemoryDataSource(new Frame(), {
        sourceType: "empty",
        filename: "stale",
      }),
    );

    const primary = installEmptyPrimaryScene(system, pipeline);

    expect(pipeline.getEntries()).toHaveLength(1);
    expect(primaryDataSource(pipeline)).toBe(primary);
    expect(system.trajectory).toBe(primary.trajectory);
    expect(system.trajectory.length).toBe(1);
    expect(primary.filename).toBe(EMPTY_SCENE_FILENAME);
  });

  it("ensurePrimaryDataSource is idempotent when a primary exists", () => {
    const system = new System();
    const pipeline = new ModifierPipeline();
    const first = installEmptyPrimaryScene(system, pipeline);
    const second = ensurePrimaryDataSource(system, pipeline);
    expect(second).toBe(first);
    expect(pipeline.getEntries()).toHaveLength(1);
  });

  it("ensurePrimaryDataSource installs when pipeline is empty", () => {
    const system = new System();
    const pipeline = new ModifierPipeline();
    // System starts with its own empty traj; ensure still installs a DS.
    system.trajectory = new Trajectory([new Frame()]);
    const primary = ensurePrimaryDataSource(system, pipeline);
    expect(primary).toBeTruthy();
    expect(pipeline.getEntries()).toHaveLength(1);
    expect(system.trajectory).toBe(primary.trajectory);
  });
});
