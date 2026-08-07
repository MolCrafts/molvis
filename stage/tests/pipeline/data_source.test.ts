import { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import { WrapPBCModifier } from "../../src/modifiers/WrapPBCModifier";
import {
  DataSource,
  type DataSourceOptions,
  FileDataSource,
  MemoryDataSource,
} from "../../src/pipeline/data_source";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import { type FrameProvider, Trajectory } from "../../src/system/trajectory";
import "../setup_wasm";

describe("Acquisition-kind DataSource subtypes", () => {
  // A PipelineContext factory used to live here, for the two tests that called
  // `DataSource.apply(frame, ctx)`. A source has no `apply` any more, so
  // nothing in this file constructs a context.

  // A FrameProvider that counts and records every get(index) call so a
  // test can assert lazy access patterns without eagerly materializing.
  class SpyFrameProvider implements FrameProvider {
    public readonly calls: number[] = [];
    private readonly _frames: Frame[];

    constructor(frames: Frame[]) {
      this._frames = frames;
    }

    get length(): number {
      return this._frames.length;
    }

    get(index: number): Frame {
      this.calls.push(index);
      return this._frames[index];
    }
  }

  // ac-001 — kind discriminators are acquisition-based.
  it("ac-001: FileDataSource.kind === 'file'", () => {
    const ds = new FileDataSource(new Trajectory([new Frame()]));
    expect(ds.kind).toBe("file");
  });

  it("ac-001: MemoryDataSource.kind === 'memory'", () => {
    const ds = new MemoryDataSource(new Frame());
    expect(ds.kind).toBe("memory");
  });

  it("ac-001: both are DataSource instances", () => {
    expect(new FileDataSource(new Trajectory([new Frame()]))).toBeInstanceOf(
      DataSource,
    );
    expect(new MemoryDataSource(new Frame())).toBeInstanceOf(DataSource);
  });

  // ac-002 — FileDataSource owns and delegates to its Trajectory.
  it("ac-002: FileDataSource.frameCount mirrors a 3-frame trajectory", () => {
    const traj = new Trajectory([new Frame(), new Frame(), new Frame()]);
    const ds = new FileDataSource(traj);
    expect(ds.frameCount).toBe(3);
  });

  it("ac-002: FileDataSource.trajectory identity-equals the passed trajectory", () => {
    const traj = new Trajectory([new Frame(), new Frame(), new Frame()]);
    const ds = new FileDataSource(traj);
    expect(ds.trajectory).toBe(traj);
  });

  it("ac-002: FileDataSource.preload(1) then cachedFrame returns frame 1", async () => {
    const f0 = new Frame();
    const f1 = new Frame();
    const f2 = new Frame();
    const ds = new FileDataSource(new Trajectory([f0, f1, f2]));
    await ds.preload(1);
    expect(ds.cachedFrame).toBe(f1);
  });

  it("ac-002: FileDataSource.getFrame(2) resolves frame 2", async () => {
    const f0 = new Frame();
    const f1 = new Frame();
    const f2 = new Frame();
    const ds = new FileDataSource(new Trajectory([f0, f1, f2]));
    expect(await ds.getFrame(2)).toBe(f2);
  });

  // ac-003 — MemoryDataSource broadcasts a single Frame as a length-1 traj.
  it("ac-003: MemoryDataSource.frameCount === 1", () => {
    const ds = new MemoryDataSource(new Frame());
    expect(ds.frameCount).toBe(1);
  });

  it("ac-003: MemoryDataSource.getFrame broadcasts the same frame for any index", () => {
    const frame = new Frame();
    const ds = new MemoryDataSource(frame);
    expect(ds.getFrame(0)).toBe(frame);
    expect(ds.getFrame(5)).toBe(frame);
  });

  it("ac-003: MemoryDataSource.frame returns the wrapped frame (Edit-mode compat)", () => {
    const frame = new Frame();
    const ds = new MemoryDataSource(frame);
    expect(ds.frame).toBe(frame);
  });

  it("ac-003: MemoryDataSource.trajectory has length 1", () => {
    const ds = new MemoryDataSource(new Frame());
    expect(ds.trajectory.length).toBe(1);
  });

  it("ac-003: MemoryDataSource.cachedFrame and peekFrame return the wrapped frame", () => {
    const frame = new Frame();
    const ds = new MemoryDataSource(frame);
    expect(ds.cachedFrame).toBe(frame);
    expect(ds.peekFrame).toBe(frame);
  });

  it("MemoryDataSource.peekFrame is undefined after dispose (no use-after-free)", () => {
    const ds = new MemoryDataSource(new Frame());
    ds.dispose();
    expect(ds.peekFrame).toBeUndefined();
    expect(() => ds.frame).toThrow(/after dispose/);
  });

  // ac-005 — distinct data sources hold distinct trajectory objects.
  it("ac-005: a FileDataSource and a MemoryDataSource hold distinct trajectories", () => {
    const fileDs = new FileDataSource(new Trajectory([new Frame()]));
    const memDs = new MemoryDataSource(new Frame());
    expect(fileDs.trajectory).not.toBe(memDs.trajectory);
  });

  it("ac-005: two MemoryDataSources hold distinct trajectories", () => {
    const dsA = new MemoryDataSource(new Frame());
    const dsB = new MemoryDataSource(new Frame());
    expect(dsA.trajectory).not.toBe(dsB.trajectory);
  });

  // ac-006 — FileDataSource over a lazy/provider-backed Trajectory is not
  // eagerly materialized: only the requested index is pulled.
  it("ac-006: constructing a FileDataSource over a lazy trajectory pulls no frames", () => {
    const spy = new SpyFrameProvider([new Frame(), new Frame(), new Frame()]);
    const traj = Trajectory.fromProvider(spy);
    expect(traj.isLazy).toBe(true);
    new FileDataSource(traj);
    expect(spy.calls).toEqual([]);
  });

  it("ac-006: preload(0) on a lazy FileDataSource pulls only index 0", async () => {
    const spy = new SpyFrameProvider([new Frame(), new Frame(), new Frame()]);
    const traj = Trajectory.fromProvider(spy);
    const ds = new FileDataSource(traj);
    await ds.preload(0);
    expect(spy.calls).toEqual([0]);
  });

  // ac-006 fallback — even for an eager trajectory, construction must not
  // touch frames until preload/getFrame is invoked.
  it("ac-006: constructing a FileDataSource does not read any frame", () => {
    const spy = new SpyFrameProvider([new Frame(), new Frame()]);
    const traj = Trajectory.fromProvider(spy);
    new FileDataSource(traj);
    expect(spy.calls.length).toBe(0);
  });

  // edge — error contracts on FileDataSource.
  it("edge: preload(out-of-range) on FileDataSource rejects with /out of range/", async () => {
    const ds = new FileDataSource(new Trajectory([new Frame()]));
    await expect(ds.preload(5)).rejects.toThrow(/out of range/i);
  });

  it("edge: cachedFrame on FileDataSource throws /preload/ before preload", () => {
    const ds = new FileDataSource(new Trajectory([new Frame()]));
    expect(() => ds.cachedFrame).toThrow(/preload/i);
  });

  // A source is not a modifier. It used to be one whose apply() returned its
  // input unchanged, and `compute` skipped those calls explicitly; now the
  // separation is in the type. These replace the two `apply is identity`
  // tests that asserted the old shape.
  it("a DataSource carries no Modifier contract", () => {
    const ds = new FileDataSource(new Trajectory([new Frame()]));
    const asAny = ds as unknown as Record<string, unknown>;
    for (const member of [
      "apply",
      "capabilities",
      "selectionScopeId",
      "sourceOwnerId",
      "matches",
      "isApplicable",
      "validate",
      "getCacheKey",
      "applyVisibility",
    ]) {
      expect(asAny[member]).toBeUndefined();
    }
  });

  it("the pipeline sorts sources and modifiers into disjoint views", () => {
    const pipeline = new ModifierPipeline();
    const source = new MemoryDataSource(new Frame());
    const modifier = new WrapPBCModifier("wrap");
    pipeline.addSource(source);
    pipeline.addModifier(modifier);

    expect(pipeline.sources().map((e) => e.id)).toEqual([source.id]);
    expect(pipeline.modifiers().map((e) => e.id)).toEqual([modifier.id]);
    expect(pipeline.getEntries()).toHaveLength(2);
  });

  // DataSourceOptions still populate provenance fields on both subtypes.
  it("DataSourceOptions populate sourceType / filename / contributedBlocks", () => {
    const options: DataSourceOptions = {
      sourceType: "file",
      filename: "topology.data",
      contributedBlocks: ["bonds"],
    };
    const ds = new MemoryDataSource(new Frame(), options);
    expect(ds.sourceType).toBe("file");
    expect(ds.filename).toBe("topology.data");
    expect(ds.contributedBlocks).toEqual(["bonds"]);
  });
});
