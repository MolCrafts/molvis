import { describe, expect, it } from "@rstest/core";
import "../../setup_wasm";
import type { MolvisApp } from "../../../src/app";
import { DrawAtomCommand, DrawBondCommand } from "../../../src/commands/draw";
import { PlaceMoleculeCommand } from "../../../src/commands/place_molecule";
import type { Trajectory } from "../../../src/system/trajectory";
import { RPCRouter } from "../../../src/transport/rpc/router";
import { decodeFrame } from "../../../src/transport/rpc/serialization";

function request(method: string, params: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: 1, method, params };
}

/**
 * Minimal app: draw_* routes to Edit commands (working tree), set_trajectory
 * still replaces. No molrs frame-surgery helpers in the draw path.
 */
function fakeApp() {
  const state: {
    trajectory?: Trajectory;
    executed: unknown[];
    commits: number;
    nextAtomId: number;
    atoms: Map<number, { x: number; y: number; z: number; element: string }>;
    /** Frames handed to `app.appendFrame`, in arrival order. */
    appended: unknown[];
    /** Length of the live trajectory as the fake app sees it. */
    nFrames: number;
    /** Indices passed to `app.seekFrame`. */
    seeks: number[];
    /** How many times the camera was re-framed. */
    fits: number;
    /** How many times the pipeline was rebuilt. */
    rebuilds: number;
  } = {
    executed: [],
    commits: 0,
    nextAtomId: 0,
    atoms: new Map(),
    appended: [],
    nFrames: 0,
    seeks: [],
    fits: 0,
    rebuilds: 0,
  };

  const app = {
    get frame() {
      return undefined;
    },
    system: {
      frame: undefined,
      get trajectory() {
        return { length: state.nFrames };
      },
      updateCurrentFrame: () => {},
    },
    modifierPipeline: {
      getEntries: () => [],
      modifiers: () => [],
      sources: () => [],
      session: () => null,
    },
    world: {
      sceneIndex: {
        getNextAtomId: () => state.nextAtomId,
        getNextBondId: () => 0,
        metaRegistry: {
          atoms: {
            getMeta: (id: number) => {
              const a = state.atoms.get(id);
              if (!a) return null;
              return {
                type: "atom" as const,
                atomId: id,
                element: a.element,
                position: { x: a.x, y: a.y, z: a.z },
              };
            },
          },
        },
      },
      fit: () => {
        state.fits += 1;
      },
      reset: () => {},
      renderOnce: () => {},
    },
    commandManager: {
      execute: async (cmd: {
        do: () => Promise<unknown> | unknown;
        constructor: { name: string };
      }) => {
        state.executed.push(cmd);
        // Simulate command effects without Babylon/artist.
        if (cmd instanceof DrawAtomCommand) {
          const id = state.nextAtomId++;
          // DrawAtomCommand already reserved id in constructor via getNextAtomId
          // — read position from the command private fields via do mock.
          const result = { atomId: id };
          // Positions: re-run a thin stub by inspecting params from a second path
          return result;
        }
        if (cmd instanceof DrawBondCommand) {
          return { bondId: 0 };
        }
        if (cmd instanceof PlaceMoleculeCommand) {
          return undefined;
        }
        return cmd.do();
      },
    },
    commitScene: () => {
      state.commits += 1;
    },
    setTrajectory: async (trajectory: Trajectory) => {
      state.trajectory = trajectory;
      state.nFrames = trajectory.length;
    },
    appendFrame: async (frame: unknown) => {
      state.appended.push(frame);
      const installedScene = state.nFrames === 0;
      state.nFrames += 1;
      return { index: state.nFrames - 1, installedScene };
    },
    seekFrame: async (index: number) => {
      state.seeks.push(index);
    },
    applyPipeline: async () => {
      state.rebuilds += 1;
      return null;
    },
    artist: {
      drawBox: () => {},
    },
  } as unknown as MolvisApp;

  // Patch execute to record atom positions for draw_atom (after handler builds cmd).
  const originalExecute = app.commandManager.execute.bind(app.commandManager);
  app.commandManager.execute = async (cmd: unknown) => {
    state.executed.push(cmd);
    if (cmd instanceof DrawAtomCommand) {
      // Access private fields through the command's do return after real partial run
      // is not possible without artist — allocate id and store a placeholder at origin
      // unless we can read Vector3 from the command.
      const anyCmd = cmd as unknown as {
        position: { x: number; y: number; z: number };
        options: { element: string };
        atomId: number;
      };
      // DrawAtomCommand constructor already took next id; keep map in sync.
      const id =
        typeof anyCmd.atomId === "number" ? anyCmd.atomId : state.nextAtomId++;
      if (id >= state.nextAtomId) state.nextAtomId = id + 1;
      const pos = anyCmd.position;
      state.atoms.set(id, {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        element: anyCmd.options.element,
      });
      return { atomId: id };
    }
    if (cmd instanceof DrawBondCommand) {
      return { bondId: 0 };
    }
    if (cmd instanceof PlaceMoleculeCommand) {
      const n = 3; // WATER fixture
      state.nextAtomId += n;
      return undefined;
    }
    return originalExecute(cmd as never);
  };

  return { app, state, router: new RPCRouter(app) };
}

const WATER = {
  blocks: {
    atoms: {
      columns: {
        x: { dtype: "f64", data: [0, 0, 0] },
        y: { dtype: "f64", data: [0, 1, -1] },
        z: { dtype: "f64", data: [0, 0, 0] },
        element: { dtype: "string", data: ["O", "H", "H"] },
        charge: { dtype: "f64", data: [-0.8, 0.4, 0.4] },
      },
    },
    bonds: {
      columns: {
        atomi: { dtype: "u32", data: [0, 0] },
        atomj: { dtype: "u32", data: [1, 2] },
        order: { dtype: "f64", data: [1, 1] },
      },
    },
  },
};

function withBuffers(frame: {
  blocks: Record<
    string,
    { columns: Record<string, { dtype: string; data: unknown }> }
  >;
}) {
  const buffers: DataView[] = [];
  const blocks: Record<string, unknown> = {};
  for (const [blockName, block] of Object.entries(frame.blocks)) {
    const columns: Record<string, unknown> = {};
    for (const [name, column] of Object.entries(block.columns)) {
      if (column.dtype === "string") {
        columns[name] = column;
        continue;
      }
      const data =
        column.dtype === "u32"
          ? new Uint32Array(column.data as number[])
          : new Float64Array(column.data as number[]);
      buffers.push(new DataView(data.buffer));
      columns[name] = {
        dtype: column.dtype,
        data: { __molvis_buffer__: true, index: buffers.length - 1 },
      };
    }
    blocks[blockName] = { columns };
  }
  return { payload: { blocks }, buffers };
}

describe("scene.draw_frame (edit working tree)", () => {
  it("places via PlaceMoleculeCommand and does not setTrajectory", async () => {
    const { state, router } = fakeApp();
    const { payload, buffers } = withBuffers(WATER);

    const response = await router.execute(
      request("scene.draw_frame", { frame: payload }),
      buffers,
    );

    expect(response.content.error).toBeUndefined();
    expect(state.trajectory).toBeUndefined();
    expect(state.executed.some((c) => c instanceof PlaceMoleculeCommand)).toBe(
      true,
    );
    const result = response.content.result as { atomIds: number[] };
    expect(result.atomIds).toHaveLength(3);
  });

  it("reports the offending block.column when a payload is malformed", async () => {
    const { router } = fakeApp();
    const response = await router.execute(
      request("scene.draw_frame", {
        frame: {
          blocks: {
            atoms: { columns: { x: { dtype: "f64", data: [0, 1, 2] } } },
          },
        },
      }),
    );

    expect(response.content.error?.code).toBe(-32602);
    expect(response.content.error?.message).toMatch(/atoms\.x/);
    expect(response.content.error?.data).toEqual({ path: "atoms.x" });
  });

  it("refuses a top-level box instead of ignoring it", async () => {
    const { router } = fakeApp();
    const { payload, buffers } = withBuffers(WATER);
    const response = await router.execute(
      request("scene.draw_frame", {
        frame: payload,
        box: { h: [], origin: [] },
      }),
      buffers,
    );
    expect(response.content.error?.message).toMatch(/put it on the frame/);
  });

  it("still rejects visual options on a data command", async () => {
    const { router } = fakeApp();
    const response = await router.execute(
      request("scene.draw_frame", {
        frame: { blocks: {} },
        options: { style: "spacefill" },
      }),
    );
    expect(response.content.error?.message).toMatch(/accepts data only/);
  });

  it("errors when the frame has no atoms", async () => {
    const { router } = fakeApp();
    const response = await router.execute(
      request("scene.draw_frame", { frame: { blocks: {} } }),
    );
    expect(response.content.error?.code).toBe(-32602);
    expect(response.content.error?.message).toMatch(/no atoms/);
  });
});

describe("scene.draw_atom / draw_bond / commit", () => {
  it("draw_atom uses DrawAtomCommand and returns atomId", async () => {
    const { state, router } = fakeApp();
    const response = await router.execute(
      request("scene.draw_atom", {
        x: 0,
        y: 0,
        z: 0,
        element: "O",
      }),
    );
    expect(response.content.error).toBeUndefined();
    expect(state.executed.some((c) => c instanceof DrawAtomCommand)).toBe(true);
    expect((response.content.result as { atomId: number }).atomId).toBe(0);
  });

  it("draw_bond requires atoms already in the working tree", async () => {
    const { router } = fakeApp();
    const response = await router.execute(
      request("scene.draw_bond", { atomi: 0, atomj: 1 }),
    );
    expect(response.content.error?.message).toMatch(/working tree/);
  });

  it("draw_bond uses DrawBondCommand after atoms exist", async () => {
    const { state, router } = fakeApp();
    await router.execute(
      request("scene.draw_atom", { x: 0, y: 0, z: 0, element: "O" }),
    );
    await router.execute(
      request("scene.draw_atom", { x: 1, y: 0, z: 0, element: "H" }),
    );
    const response = await router.execute(
      request("scene.draw_bond", { atomi: 0, atomj: 1 }),
    );
    expect(response.content.error).toBeUndefined();
    expect(state.executed.some((c) => c instanceof DrawBondCommand)).toBe(true);
  });

  it("commit calls commitScene (Ctrl+S path)", async () => {
    const { state, router } = fakeApp();
    const response = await router.execute(request("scene.commit", {}));
    expect(response.content.error).toBeUndefined();
    expect(state.commits).toBe(1);
  });
});

describe("scene.set_trajectory", () => {
  it("takes each frame's own box rather than a parallel array", async () => {
    const { state, router } = fakeApp();
    const { payload, buffers } = withBuffers(WATER);

    const response = await router.execute(
      request("scene.set_trajectory", { frames: [payload] }),
      buffers,
    );

    expect(response.content.error).toBeUndefined();
    expect(state.trajectory?.length).toBe(1);
  });

  it("refuses the old parallel boxes array", async () => {
    const { router } = fakeApp();
    const { payload, buffers } = withBuffers(WATER);
    const response = await router.execute(
      request("scene.set_trajectory", { frames: [payload], boxes: [null] }),
      buffers,
    );
    expect(response.content.error?.message).toMatch(
      /put each box on its frame/,
    );
  });

  it("names the frame index in a decode error", async () => {
    const { router } = fakeApp();
    const response = await router.execute(
      request("scene.set_trajectory", {
        frames: [
          { blocks: {} },
          {
            blocks: { atoms: { columns: { x: { dtype: "nope", data: [] } } } },
          },
        ],
      }),
    );
    expect(response.content.error?.message).toMatch(/frames\[1\]/);
  });
});

describe("scene.export_frame", () => {
  it("returns a wire frame plus its binary buffers", async () => {
    const { app, router } = fakeApp();
    const { payload, buffers } = withBuffers(WATER);
    const built = decodeFrame(payload, buffers);
    (app as unknown as { execute: unknown }).execute = () => ({ frame: built });

    const response = await router.execute(request("scene.export_frame", {}));

    expect(response.content.error).toBeUndefined();
    expect(response.buffers?.length).toBeGreaterThan(0);
    const result = response.content.result as {
      frame: { blocks: Record<string, unknown> };
    };
    expect(Object.keys(result.frame.blocks).sort()).toEqual(["atoms", "bonds"]);
  });
});

describe("scene.append_frame", () => {
  it("appends one frame and reports the new length", async () => {
    const { state, router } = fakeApp();
    const { payload, buffers } = withBuffers(WATER);

    const response = await router.execute(
      request("scene.append_frame", { frame: payload }),
      buffers,
    );

    expect(response.content.error).toBeUndefined();
    expect(response.content.result).toMatchObject({ index: 0, nFrames: 1 });
    expect(state.appended).toHaveLength(1);
  });

  it("frames the camera once, on the frame that installs the scene", async () => {
    // A stream that re-fits per step is unusable; a stream that never fits
    // leaves the first frame off-screen. Exactly one fit, on frame 0.
    const { state, router } = fakeApp();

    for (let i = 0; i < 4; i++) {
      const { payload, buffers } = withBuffers(WATER);
      await router.execute(
        request("scene.append_frame", { frame: payload }),
        buffers,
      );
    }

    expect(state.nFrames).toBe(4);
    expect(state.fits).toBe(1);
  });

  it("does not rebuild the pipeline for a mid-stream frame", async () => {
    // set_trajectory forces a full rebuild every call. Append must not, or
    // the changeKind fast path never gets a chance to classify.
    const { state, router } = fakeApp();

    for (let i = 0; i < 3; i++) {
      const { payload, buffers } = withBuffers(WATER);
      await router.execute(
        request("scene.append_frame", { frame: payload }),
        buffers,
      );
    }

    expect(state.rebuilds).toBe(1); // the installing frame only
  });

  it("follows the tail by default", async () => {
    const { state, router } = fakeApp();

    for (let i = 0; i < 3; i++) {
      const { payload, buffers } = withBuffers(WATER);
      await router.execute(
        request("scene.append_frame", { frame: payload }),
        buffers,
      );
    }

    // Frame 0 installed the scene (no seek); 1 and 2 followed.
    expect(state.seeks).toEqual([1, 2]);
  });

  it("leaves the playhead alone when follow is false", async () => {
    const { state, router } = fakeApp();

    for (let i = 0; i < 3; i++) {
      const { payload, buffers } = withBuffers(WATER);
      await router.execute(
        request("scene.append_frame", { frame: payload, follow: false }),
        buffers,
      );
    }

    expect(state.seeks).toEqual([]);
  });

  it("requires a frame payload", async () => {
    const { router } = fakeApp();
    const response = await router.execute(request("scene.append_frame", {}));
    expect(response.content.error?.message).toMatch(/requires a 'frame'/);
  });

  it("refuses a top-level box", async () => {
    const { router } = fakeApp();
    const { payload, buffers } = withBuffers(WATER);
    const response = await router.execute(
      request("scene.append_frame", { frame: payload, box: {} }),
      buffers,
    );
    expect(response.content.error?.message).toMatch(/put it on the frame/);
  });

  it("names itself in a decode error", async () => {
    const { router } = fakeApp();
    const response = await router.execute(
      request("scene.append_frame", {
        frame: {
          blocks: { atoms: { columns: { x: { dtype: "nope", data: [] } } } },
        },
      }),
    );
    expect(response.content.error?.message).toMatch(/scene\.append_frame/);
  });
});
