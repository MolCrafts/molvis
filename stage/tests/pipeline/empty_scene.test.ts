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
import { makeFrame } from "../fixtures/dcd";

describe("empty pipeline bootstrap", () => {
  it("createEmptyPrimaryDataSource is a length-1 empty memory source", () => {
    const ds = createEmptyPrimaryDataSource();
    expect(ds).toBeInstanceOf(MemoryDataSource);
    expect(ds.sourceType).toBe("empty");
    expect(ds.filename).toBe(EMPTY_SCENE_FILENAME);
    expect(ds.frameCount).toBe(1);
    expect(ds.frame.has("atoms")).toBe(false);
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

  it("bootstrapEmptyPipeline reuses System's empty trajectory across resets", () => {
    const system = new System();
    const pipeline = new ModifierPipeline();
    const atBoot = system.trajectory;

    bootstrapEmptyPipeline(system, pipeline);
    bootstrapEmptyPipeline(system, pipeline);

    // One molrs Frame for the empty scene, not a fresh one per reset.
    expect(system.trajectory).toBe(atBoot);
    expect(system.trajectory.length).toBe(1);
    expect(system.frame.has("atoms")).toBe(false);
  });

  it("bootstrapEmptyPipeline rebuilds the empty scene once it holds data", () => {
    const system = new System();
    const pipeline = new ModifierPipeline();
    const loaded = new Trajectory([makeFrame(2, 1)]);
    system.trajectory = loaded;

    bootstrapEmptyPipeline(system, pipeline);

    expect(system.trajectory).not.toBe(loaded);
    expect(system.trajectory.length).toBe(1);
    expect(system.frame.has("atoms")).toBe(false);
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
