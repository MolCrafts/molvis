import { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import { FileDataSource } from "../src/pipeline/data_source";
import { MeshOverlayModifier } from "../src/pipeline/mesh_overlay";
import { ModifierPipeline } from "../src/pipeline/pipeline";
import { SceneSession, type SceneSessionHost } from "../src/scene_session";
import { System } from "../src/system";
import { Trajectory } from "../src/system/trajectory";

/** Host stub: enough for replaceScene without Babylon / artist. */
function hostStub(): {
  host: SceneSessionHost;
  system: System;
  pipeline: ModifierPipeline;
} {
  const system = new System();
  const pipeline = new ModifierPipeline();
  const host: SceneSessionHost = {
    artist: { clear: () => {} } as SceneSessionHost["artist"],
    commandManager: {
      clearHistory: () => {},
    } as SceneSessionHost["commandManager"],
    pipeline,
    system,
    isRunning: () => false,
    setFrameIndex: () => {},
    clearLastRenderedFrame: () => {},
    renderActiveTrajectoryFrame: async () => {},
    applyPipeline: async () => null,
  };
  return { host, system, pipeline };
}

function oneOxygenFrame(): Frame {
  const frame = new Frame();
  const atoms = frame.createBlock("atoms");
  atoms.set("x", new Float64Array([0]));
  atoms.set("y", new Float64Array([0]));
  atoms.set("z", new Float64Array([0]));
  atoms.set("element", ["O"]);
  return frame;
}

describe("SceneSession.replaceScene", () => {
  it("auto-attaches Particles on replaceScene (file load / set_trajectory)", async () => {
    // Load paths still replace the primary source; they must attach Draws so
    // the loaded trajectory paints. RPC draw_frame is append-only and does
    // not go through replaceScene.
    const { host, pipeline } = hostStub();
    const session = new SceneSession(host);

    await session.replaceScene(new Trajectory([oneOxygenFrame()]), {
      sourceType: "backend",
      filename: "backend",
    });

    const names = pipeline.getEntries().map((m) => m.name);
    expect(names).toContain("Particles");
    expect(
      pipeline.getEntries().filter((m) => m.name === "Particles"),
    ).toHaveLength(1);
  });

  it("attaches nothing drawable for an empty frame", async () => {
    const { host, pipeline } = hostStub();
    const session = new SceneSession(host);

    await session.replaceScene(new Trajectory([new Frame()]), {
      sourceType: "empty",
      filename: "",
    });

    expect(pipeline.getEntries().map((m) => m.name)).not.toContain("Particles");
  });

  it("keeps Mesh overlays when replacing molecular data", async () => {
    const { host, pipeline } = hostStub();
    const session = new SceneSession(host);
    const mesh = new MeshOverlayModifier();
    mesh.setMesh(
      {
        positions: new Float32Array(9),
        indices: new Uint32Array([0, 1, 2]),
        normals: new Float32Array(9),
      },
      "cavity.stl",
    );
    pipeline.addModifier(mesh);

    await session.replaceScene(new Trajectory([oneOxygenFrame()]), {
      filename: "sys.data",
    });

    expect(
      pipeline.modifiers().some((m) => m instanceof MeshOverlayModifier),
    ).toBe(true);
    expect(pipeline.meshOverlayCount()).toBe(1);
  });
});

describe("SceneSession.addDataSource", () => {
  it("promotes System to the longer trajectory when stacking DCD onto a structure", async () => {
    const { host, system } = hostStub();
    const session = new SceneSession(host);
    const structure = new Trajectory([oneOxygenFrame()]);
    const frames = [oneOxygenFrame(), oneOxygenFrame(), oneOxygenFrame()];
    const traj = new Trajectory(frames);

    await session.replaceScene(structure, { filename: "sys.data" });
    expect(system.trajectory.indexedLength).toBe(1);

    await session.addDataSource(
      new FileDataSource(traj, { filename: "sys.dcd" }),
    );
    expect(system.trajectory).toBe(traj);
    expect(system.trajectory.indexedLength).toBe(3);
  });
});

describe("SceneSession.appendFrame", () => {
  it("installs a trajectory source on the first append to an empty scene", async () => {
    // Boot is empty pipeline — first append installs a File Loader.
    const { host, pipeline, system } = hostStub();
    const session = new SceneSession(host);
    session.bootstrapEmptyPrimary();

    const result = await session.appendFrame(oneOxygenFrame(), undefined, {
      sourceType: "backend",
      filename: "backend",
    });

    expect(result).toEqual({ index: 0, installedScene: true });
    const primary = pipeline
      .getEntries()
      .find((m) => m instanceof FileDataSource);
    expect(primary).toBeDefined();
    expect((primary as FileDataSource).trajectory).toBe(system.trajectory);
  });

  it("grows the installed source on later appends", async () => {
    const { host, pipeline, system } = hostStub();
    const session = new SceneSession(host);
    session.bootstrapEmptyPrimary();

    await session.appendFrame(oneOxygenFrame());
    const second = await session.appendFrame(oneOxygenFrame());
    const third = await session.appendFrame(oneOxygenFrame());

    expect(second).toEqual({ index: 1, installedScene: false });
    expect(third).toEqual({ index: 2, installedScene: false });
    expect(system.trajectory.length).toBe(3);
    expect(
      pipeline.getEntries().filter((m) => m instanceof FileDataSource),
    ).toHaveLength(1);
  });

  it("grows the source the pipeline actually reads, not a detached copy", async () => {
    // The DataSource and System share one Trajectory instance. If
    // append ever wrote to a different object the timeline would advance
    // while the composition head kept replaying the first frame.
    const { host, pipeline } = hostStub();
    const session = new SceneSession(host);
    session.bootstrapEmptyPrimary();

    await session.appendFrame(oneOxygenFrame());
    await session.appendFrame(oneOxygenFrame());

    const primary = pipeline
      .getEntries()
      .find((m): m is FileDataSource => m instanceof FileDataSource);
    expect(primary?.frameCount).toBe(2);
  });

  it("appends onto a scene that arrived via replaceScene", async () => {
    const { host, system } = hostStub();
    const session = new SceneSession(host);

    await session.replaceScene(new Trajectory([oneOxygenFrame()]), {
      sourceType: "backend",
      filename: "backend",
    });
    const result = await session.appendFrame(oneOxygenFrame());

    expect(result).toEqual({ index: 1, installedScene: false });
    expect(system.trajectory.length).toBe(2);
  });

  it("leaves the playhead where it was", async () => {
    // A user parked on an earlier frame must not be yanked forward by
    // arriving data; following the tail is the caller's explicit seek.
    const { host, system } = hostStub();
    const session = new SceneSession(host);
    session.bootstrapEmptyPrimary();

    await session.appendFrame(oneOxygenFrame());
    await session.appendFrame(oneOxygenFrame());
    await session.appendFrame(oneOxygenFrame());

    expect(system.trajectory.currentIndex).toBe(0);
  });

  it("attaches Draw modifiers once, not per appended frame", async () => {
    const { host, pipeline } = hostStub();
    const session = new SceneSession(host);
    session.bootstrapEmptyPrimary();

    await session.appendFrame(oneOxygenFrame());
    await session.appendFrame(oneOxygenFrame());
    await session.appendFrame(oneOxygenFrame());

    expect(
      pipeline.getEntries().filter((m) => m.name === "Particles"),
    ).toHaveLength(1);
  });
});

describe("SceneSession replacement ownership", () => {
  it("does not install an older source after a newer scene has loaded", async () => {
    const { host, system, pipeline } = hostStub();
    const session = new SceneSession(host);
    let resolve!: (frame: Frame) => void;
    const waiting = new Promise<Frame>((done) => {
      resolve = done;
    });
    const old = Trajectory.fromAsyncProvider({ length: 1, get: () => waiting });
    const pending = session.replaceScene(old);
    const newest = new Trajectory([oneOxygenFrame()]);
    await session.replaceScene(newest);
    resolve(new Frame());
    await pending;
    expect(system.trajectory).toBe(newest);
    expect(pipeline.sources()).toHaveLength(1);
    expect(pipeline.sources()[0].trajectory).toBe(newest);
    expect(system.frame).toBe(newest.currentFrame);
  });

  it("does not resurrect sources after a hard reset", async () => {
    const { host, system, pipeline } = hostStub();
    const session = new SceneSession(host);
    let resolve!: (frame: Frame) => void;
    const waiting = new Promise<Frame>((done) => {
      resolve = done;
    });
    const pending = session.replaceScene(
      Trajectory.fromAsyncProvider({ length: 1, get: () => waiting }),
    );
    session.bootstrapEmptyPrimary();
    const empty = system.frame;
    resolve(oneOxygenFrame());
    await pending;
    expect(pipeline.sources()).toHaveLength(0);
    expect(system.frame).toBe(empty);
  });
});

describe("SceneSession preload ownership", () => {
  it("does not auto-attach or report an obsolete preload failure after reset", async () => {
    const { host, pipeline } = hostStub();
    const session = new SceneSession(host);
    let entered!: () => void;
    const started = new Promise<void>((done) => {
      entered = done;
    });
    let reject!: (error: Error) => void;
    const waiting = new Promise<void>((_, fail) => {
      reject = fail;
    });
    const addSource = pipeline.addSource.bind(pipeline);
    pipeline.addSource = (source) => {
      source.preload = async () => {
        entered();
        await waiting;
      };
      return addSource(source);
    };
    const pending = session.replaceScene(new Trajectory([oneOxygenFrame()]));
    await started;
    session.bootstrapEmptyPrimary();
    reject(new Error("disposed source"));
    await expect(pending).resolves.toBeUndefined();
    expect(pipeline.sources()).toHaveLength(0);
    expect(pipeline.modifiers()).toHaveLength(0);
  });

  it("does not attach a source removed while its preload was pending", async () => {
    const { host, pipeline } = hostStub();
    const session = new SceneSession(host);
    const source = new FileDataSource(new Trajectory([oneOxygenFrame()]));
    let resolve!: () => void;
    const waiting = new Promise<void>((done) => {
      resolve = done;
    });
    source.preload = () => waiting;
    const pending = session.addDataSource(source);
    await session.removeDataSource(source.id);
    resolve();
    await pending;
    expect(pipeline.sources()).toHaveLength(0);
    expect(pipeline.modifiers()).toHaveLength(0);
  });
});
