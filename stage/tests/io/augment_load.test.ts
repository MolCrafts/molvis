import { describe, expect, it } from "@rstest/core";
import "../setup_wasm";
import type { MolvisApp } from "../../src/app";
import { EventEmitter, type MolvisEventMap } from "../../src/events";
import { loadFileContent } from "../../src/io";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import { SceneSession, type SceneSessionHost } from "../../src/scene_session";
import { System } from "../../src/system";
import { composeSources } from "../../src/system/source_composition";
import { buildMultiDcd } from "../fixtures/dcd";

/** Real System + pipeline + a thin SceneSession-backed host; stub the rest. */
function fakeApp(): {
  app: unknown;
  system: System;
  pipeline: ModifierPipeline;
} {
  const events = new EventEmitter<MolvisEventMap>();
  const system = new System(events);
  const pipeline = new ModifierPipeline();
  const host: SceneSessionHost = {
    artist: { clear: () => {} } as SceneSessionHost["artist"],
    commandManager: {
      clearHistory: () => {},
    } as SceneSessionHost["commandManager"],
    pipeline,
    system,
    isRunning: () => true,
    setFrameIndex: () => {},
    clearLastRenderedFrame: () => {},
    renderActiveTrajectoryFrame: async () => {},
    applyPipeline: async () => null,
  };
  const session = new SceneSession(host);
  const app = {
    modifierPipeline: pipeline,
    system,
    events,
    addDataSource: (ds: unknown) => session.addDataSource(ds as never),
    replaceScene: (traj: unknown, meta?: unknown) =>
      session.replaceScene(traj as never, meta as never),
    applyPipeline: host.applyPipeline,
    world: { fit: () => {} },
    setMode: () => {},
  };
  return { app, system, pipeline };
}

describe("loadFileContent data -> dcd augment", () => {
  it("promotes System and advances composed coords through seek", async () => {
    const data = `LAMMPS data file via molvis test

3 atoms
1 atom types

0.0 10.0 xlo xhi
0.0 10.0 ylo yhi
0.0 10.0 zlo zhi

Masses

1 12.0

Atoms # atomic

3 1 1.0 2.0 3.0
1 1 4.0 5.0 6.0
2 1 7.0 8.0 9.0
`;
    const { app, system, pipeline } = fakeApp();

    await loadFileContent(
      app as unknown as MolvisApp,
      data,
      "sys.data",
      "lammps",
      "replace",
    );
    expect(system.trajectory.indexedLength).toBe(1);

    const bytes = buildMultiDcd([0, 1, 2], { atomCount: 3, withId: false });
    await loadFileContent(
      app as unknown as MolvisApp,
      bytes,
      "sys.dcd",
      "dcd",
      "augment",
    );

    expect(system.trajectory.indexedLength).toBe(3);

    const sources = pipeline.sources().map((s) => ({
      id: s.id,
      trajectory: s.trajectory,
    }));

    const ok1 = await system.seekFrame(1);
    expect(ok1).toBe(true);
    const composed1 = await composeSources(
      sources,
      system.trajectory.currentIndex,
    );
    const x1 = composed1.get("atoms").view("x") as Float64Array;
    expect(x1?.[1]).toBeCloseTo(1, 5);

    const ok2 = await system.seekFrame(2);
    expect(ok2).toBe(true);
    const composed2 = await composeSources(
      sources,
      system.trajectory.currentIndex,
    );
    const x2 = composed2.get("atoms").view("x") as Float64Array;
    expect(x2?.[1]).toBeCloseTo(2, 5);
  });
});
