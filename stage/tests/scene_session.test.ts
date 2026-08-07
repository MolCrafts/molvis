import { Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "./setup_wasm";
import { FileDataSource } from "../src/pipeline/data_source";
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
  atoms.setColF("x", new Float64Array([0]));
  atoms.setColF("y", new Float64Array([0]));
  atoms.setColF("z", new Float64Array([0]));
  atoms.setColStr("element", ["O"]);
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
});

describe("SceneSession.appendFrame", () => {
  it("installs a trajectory source on the first append to an empty scene", async () => {
    // Boot's primary is a MemoryDataSource whose getFrame(_) ignores the
    // index — growing System's trajectory under it would lengthen the
    // timeline while the canvas stayed on one frame.
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
