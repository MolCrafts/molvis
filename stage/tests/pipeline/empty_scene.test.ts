import { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import { MemoryDataSource } from "../../src/pipeline/data_source";
import {
  bootstrapEmptyPipeline,
  createEmptyPrimaryDataSource,
  EMPTY_SCENE_FILENAME,
  ensurePrimaryDataSource,
  primaryDataSource,
} from "../../src/pipeline/empty_scene";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import { System } from "../../src/system";
import { Trajectory } from "../../src/system/trajectory";

describe("empty pipeline bootstrap", () => {
  it("createEmptyPrimaryDataSource is a length-1 empty memory source", () => {
    const ds = createEmptyPrimaryDataSource();
    expect(ds).toBeInstanceOf(MemoryDataSource);
    expect(ds.sourceType).toBe("empty");
    expect(ds.filename).toBe(EMPTY_SCENE_FILENAME);
    expect(ds.frameCount).toBe(1);
    expect(ds.frame.getBlock("atoms")).toBeUndefined();
    ds.dispose();
  });

  it("bootstrapEmptyPipeline clears sources and leaves no primary", () => {
    const system = new System();
    const pipeline = new ModifierPipeline();
    pipeline.addSource(
      new MemoryDataSource(new Frame(), {
        sourceType: "empty",
        filename: "stale",
      }),
    );

    bootstrapEmptyPipeline(system, pipeline);

    expect(pipeline.getEntries()).toHaveLength(0);
    expect(primaryDataSource(pipeline)).toBeUndefined();
    expect(system.trajectory.length).toBe(1);
  });

  it("ensurePrimaryDataSource does not auto-install when empty", () => {
    const system = new System();
    const pipeline = new ModifierPipeline();
    system.trajectory = new Trajectory([new Frame()]);
    expect(ensurePrimaryDataSource(system, pipeline)).toBeUndefined();
    expect(pipeline.getEntries()).toHaveLength(0);
  });

  it("ensurePrimaryDataSource returns existing primary", () => {
    const system = new System();
    const pipeline = new ModifierPipeline();
    const ds = new MemoryDataSource(new Frame(), {
      sourceType: "file",
      filename: "x.xyz",
    });
    pipeline.addSource(ds);
    system.trajectory = ds.trajectory;
    expect(ensurePrimaryDataSource(system, pipeline)).toBe(ds);
  });
});
