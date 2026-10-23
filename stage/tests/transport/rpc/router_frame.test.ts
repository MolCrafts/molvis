import { toDomainUint } from "@molcrafts/molvis-core";
import type { Reversible } from "@molcrafts/molvis-core/command";
import {
  Box,
  Frame,
  readEncodedFrame,
  writeEncodedFrame,
} from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import "../../setup_wasm";
import type { MolvisApp } from "../../../src/app";
import { DrawAtomCommand, DrawBondCommand } from "../../../src/commands/draw";
import { PlaceMoleculeCommand } from "../../../src/commands/place_molecule";
import type { Trajectory } from "../../../src/system/trajectory";
import { RPCRouter } from "../../../src/transport/rpc/router";
import { BUFFER_REF_MARKER } from "../../../src/transport/rpc/types";

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
      state.nFrames = trajectory.indexedLength;
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
  // `execute` is generic in the command's result, so the fake has to be too:
  // each branch stands in for the result the real command would have produced.
  const originalExecute = app.commandManager.execute.bind(app.commandManager);
  app.commandManager.execute = async <T>(cmd: Reversible<T>): Promise<T> => {
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
      return { atomId: id } as T;
    }
    if (cmd instanceof DrawBondCommand) {
      return { bondId: 0 } as T;
    }
    if (cmd instanceof PlaceMoleculeCommand) {
      const n = 3; // WATER fixture
      state.nextAtomId += n;
      return undefined as T;
    }
    return originalExecute(cmd);
  };

  return { app, state, router: new RPCRouter(app) };
}

function water(): Frame {
  const frame = new Frame();
  const atoms = frame.createBlock("atoms");
  atoms.set("x", new Float64Array([0, 0, 0]));
  atoms.set("y", new Float64Array([0, 1, -1]));
  atoms.set("z", new Float64Array([0, 0, 0]));
  atoms.set("element", ["O", "H", "H"]);
  atoms.set("charge", new Float64Array([-0.8, 0.4, 0.4]));
  const bonds = frame.createBlock("bonds");
  bonds.set("atomi", toDomainUint([0, 0]));
  bonds.set("atomj", toDomainUint([1, 2]));
  bonds.set("order", new Float64Array([1, 1]));
  return frame;
}

const REF0 = { [BUFFER_REF_MARKER]: true, index: 0 };

/** A Frame as the controller sends it: molrs bytes as buffer 0 plus a ref. */
function sent(frame: Frame = water()) {
  const bytes = writeEncodedFrame(frame, "msgpack");
  frame.free();
  return { payload: REF0, buffers: [new DataView(bytes.buffer)] };
}

/** molrs JSON Frame bytes, for payloads molrs-wasm cannot build directly. */
function fromJson(json: unknown): Frame {
  return readEncodedFrame(
    new TextEncoder().encode(JSON.stringify(json)),
    "json",
  );
}

/** Little-endian f64 bytes, as molrs's JSON encoding spells a float column. */
function f64Bytes(values: number[]): number[] {
  return Array.from(new Uint8Array(new Float64Array(values).buffer));
}

describe("scene.draw_frame (edit working tree)", () => {
  it("places via PlaceMoleculeCommand and does not setTrajectory", async () => {
    const { state, router } = fakeApp();
    const { payload, buffers } = sent();

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

  it("takes the bytes inline from the in-process transport", async () => {
    const { state, router } = fakeApp();
    const bytes = writeEncodedFrame(water(), "msgpack");

    const response = await router.execute(
      request("scene.draw_frame", { frame: bytes }),
    );

    expect(response.content.error).toBeUndefined();
    expect(state.executed.some((c) => c instanceof PlaceMoleculeCommand)).toBe(
      true,
    );
  });

  it("reports molrs's refusal of bytes that are not a Frame", async () => {
    const { router } = fakeApp();
    const response = await router.execute(
      request("scene.draw_frame", { frame: REF0 }),
      [new DataView(new Uint8Array([1, 2, 3]).buffer)],
    );

    expect(response.content.error?.code).toBe(-32602);
    expect(response.content.error?.message).toMatch(/scene\.draw_frame frame/);
  });

  it("refuses a dangling buffer reference", async () => {
    const { router } = fakeApp();
    const response = await router.execute(
      request("scene.draw_frame", { frame: REF0 }),
    );
    expect(response.content.error?.code).toBe(-32602);
    expect(response.content.error?.message).toMatch(/out of range/);
  });

  it("refuses a frame that is not bytes", async () => {
    const { router } = fakeApp();
    const response = await router.execute(
      request("scene.draw_frame", { frame: { blocks: {} } }),
    );
    expect(response.content.error?.code).toBe(-32602);
    expect(response.content.error?.message).toMatch(/molrs Frame bytes/);
  });

  it("refuses a top-level box instead of ignoring it", async () => {
    const { router } = fakeApp();
    const { payload, buffers } = sent();
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
    const { payload, buffers } = sent(new Frame());
    const response = await router.execute(
      request("scene.draw_frame", { frame: payload }),
      buffers,
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
    const frame = water();
    frame.box = Box.cube(10, new Float64Array([0, 0, 0]), true, true, true);
    const { payload, buffers } = sent(frame);

    const response = await router.execute(
      request("scene.set_trajectory", { frames: [payload] }),
      buffers,
    );

    expect(response.content.error).toBeUndefined();
    expect(state.trajectory?.length).toBe(1);
    expect(state.trajectory?.get(0)?.box?.volume()).toBeCloseTo(1000);
  });

  it("refuses the old parallel boxes array", async () => {
    const { router } = fakeApp();
    const { payload, buffers } = sent();
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
    const { buffers } = sent();
    const response = await router.execute(
      request("scene.set_trajectory", {
        frames: [REF0, { [BUFFER_REF_MARKER]: true, index: 1 }],
      }),
      buffers,
    );
    expect(response.content.error?.message).toMatch(/frames\[1\]/);
  });
});

describe("scene.export_frame", () => {
  it("returns a buffer reference to the frame's molrs bytes", async () => {
    const { app, router } = fakeApp();
    const built = water();
    (app as unknown as { execute: unknown }).execute = () => ({ frame: built });

    const response = await router.execute(request("scene.export_frame", {}));

    expect(response.content.error).toBeUndefined();
    expect(response.content.result).toEqual({ frame: REF0 });
    expect(response.buffers).toHaveLength(1);
    const back = readEncodedFrame(
      new Uint8Array(response.buffers?.[0] as ArrayBuffer),
      "msgpack",
    );
    expect(back.keys().sort()).toEqual(["atoms", "bonds"]);
    back.free();
  });
});

describe("scene.append_frame", () => {
  it("appends one frame and reports the new length", async () => {
    const { state, router } = fakeApp();
    const { payload, buffers } = sent();

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
      const { payload, buffers } = sent();
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
      const { payload, buffers } = sent();
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
      const { payload, buffers } = sent();
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
      const { payload, buffers } = sent();
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
    const { payload, buffers } = sent();
    const response = await router.execute(
      request("scene.append_frame", { frame: payload, box: {} }),
      buffers,
    );
    expect(response.content.error?.message).toMatch(/put it on the frame/);
  });

  it("names itself in a decode error", async () => {
    const { router } = fakeApp();
    const response = await router.execute(
      request("scene.append_frame", { frame: REF0 }),
    );
    expect(response.content.error?.message).toMatch(/scene\.append_frame/);
  });
});

describe("scene.draw_box", () => {
  it("draws the box its frame carries", async () => {
    const { app, router } = fakeApp();
    const drawn: Box[] = [];
    (app.artist as unknown as { drawBox: (box: Box) => void }).drawBox = (
      box,
    ) => drawn.push(box);
    const carrier = new Frame();
    carrier.box = Box.cube(4, new Float64Array([0, 0, 0]), true, true, true);
    const { payload, buffers } = sent(carrier);

    const response = await router.execute(
      request("scene.draw_box", { frame: payload }),
      buffers,
    );

    expect(response.content.error).toBeUndefined();
    expect(drawn).toHaveLength(1);
    expect(drawn[0].volume()).toBeCloseTo(64);
  });

  it("refuses a frame without a box", async () => {
    const { router } = fakeApp();
    const { payload, buffers } = sent(new Frame());
    const response = await router.execute(
      request("scene.draw_box", { frame: payload }),
      buffers,
    );
    expect(response.content.error?.message).toMatch(/carries no box/);
  });
});

describe("scene.set_frame_labels", () => {
  function withTrajectory(n: number) {
    const { app, router } = fakeApp();
    const frames = Array.from({ length: n }, () => new Frame());
    const patched = app as unknown as {
      system: unknown;
      events: unknown;
    };
    patched.system = {
      trajectory: { indexedLength: n, get: (i: number) => frames[i] },
    };
    patched.events = { emit: () => {} };
    return { router, frames };
  }

  it("stores each label row as frame meta", async () => {
    const { router, frames } = withTrajectory(2);
    const labels = new Frame();
    labels.createBlock("labels").set("energy", new Float64Array([1.5, 2.5]));
    const { payload, buffers } = sent(labels);

    const response = await router.execute(
      request("scene.set_frame_labels", { labels: payload }),
      buffers,
    );

    expect(response.content.result).toEqual({ success: true, nLabels: 1 });
    expect(frames.map((f) => f.getMetaScalar("energy"))).toEqual([1.5, 2.5]);
  });

  it("leaves a null row unset instead of writing its filled value", async () => {
    const { router, frames } = withTrajectory(2);
    const labels = fromJson({
      blocks: {
        labels: {
          shape: [2],
          columns: {
            energy: { dtype: "float", shape: [2], data: f64Bytes([1.5, 0]) },
          },
          validity: { energy: [true, false] },
        },
      },
      meta: {},
    });
    expect(Array.from(labels.get("labels")?.validity("energy") ?? [])).toEqual([
      1, 0,
    ]);
    const { payload, buffers } = sent(labels);

    await router.execute(
      request("scene.set_frame_labels", { labels: payload }),
      buffers,
    );

    expect(frames[0].getMetaScalar("energy")).toBe(1.5);
    expect(frames[1].getMetaScalar("energy")).toBeUndefined();
  });

  it("refuses labels whose length is not the trajectory's", async () => {
    const { router } = withTrajectory(3);
    const labels = new Frame();
    labels.createBlock("labels").set("energy", new Float64Array([1, 2]));
    const { payload, buffers } = sent(labels);

    const response = await router.execute(
      request("scene.set_frame_labels", { labels: payload }),
      buffers,
    );

    expect(response.content.error?.message).toMatch(/expected 3/);
  });
});
