import { describe, expect, it } from "@rstest/core";
import type { MolvisApp } from "../src/app";
import type { RepresentationStyle } from "../src/artist/representation";
import { RPCRouter } from "../src/transport/rpc/router";

function request(method: string, params: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: 1, method, params };
}

function mockStyleApp(overrides: Record<string, unknown> = {}) {
  let representation: RepresentationStyle = {
    id: "ball-and-stick",
    name: "Ball and Stick",
    atomRadiusMode: "uniform",
    atomRadiusScale: 1,
    uniformAtomRadius: 0.3,
    atomVisibility: "all",
    atomShading: "lit",
    atomOutline: 0,
    bondRadiusScale: 1,
    showBonds: true,
    bondShading: "lit",
    bondColorMode: "theme",
    bondOrderMode: "multiple",
    bondOutline: 0,
    outlineConfigurable: true,
    outlineEnabled: true,
    labels: "none",
    hideCarbonHydrogens: false,
  } as RepresentationStyle;

  let pipelineCalls = 0;
  let redrawCalls = 0;
  const events: string[] = [];

  const app = {
    frame: undefined as unknown,
    styleManager: {
      setRepresentation: (repr: RepresentationStyle) => {
        representation = repr;
      },
      getRepresentation: () => representation,
      setOutlineEnabled: (enabled: boolean) => {
        representation = { ...representation, outlineEnabled: enabled };
      },
      setAtomRadiusScale: (scale: number) => {
        representation = { ...representation, atomRadiusScale: scale };
      },
      setBondRadiusScale: (scale: number) => {
        representation = { ...representation, bondRadiusScale: scale };
      },
    },
    applyPipeline: async () => {
      pipelineCalls += 1;
      return null;
    },
    artist: {
      redrawFromSceneIndex: () => {
        redrawCalls += 1;
      },
    },
    events: {
      emit: (name: string) => {
        events.push(name);
      },
    },
    ...overrides,
  } as unknown as MolvisApp;

  return {
    app,
    get representation() {
      return representation;
    },
    get pipelineCalls() {
      return pipelineCalls;
    },
    get redrawCalls() {
      return redrawCalls;
    },
    get events() {
      return events;
    },
  };
}

describe("global representation RPC scope", () => {
  it("rejects visual options on draw commands", async () => {
    const router = new RPCRouter({
      system: { trajectory: undefined },
    } as unknown as MolvisApp);
    const response = await router.execute(
      request("scene.draw_frame", {
        frame: { blocks: {} },
        options: { style: "spacefill" },
      }),
    );

    expect(response.content.error?.message).toMatch(/accepts data only/);
  });

  it("changes representation only through the global style command", async () => {
    const mock = mockStyleApp();
    const router = new RPCRouter(mock.app);
    const response = await router.execute(
      request("view.set_style", { style: "tube" }),
    );

    expect(response.content.error).toBeUndefined();
    expect(mock.representation.id).toBe("tube");
    expect(mock.events).toContain("representation-change");
  });

  it("routes the optional 2-D outline through global style state", async () => {
    const mock = mockStyleApp();
    const router = new RPCRouter(mock.app);
    const response = await router.execute(
      request("view.set_style", { style: "graph", outline: false }),
    );

    expect(response.content.error).toBeUndefined();
    expect(mock.representation.id).toBe("graph");
    expect(mock.representation.outlineEnabled).toBe(false);
  });

  it("runs applyPipeline only once per set_style (no multi-flash)", async () => {
    const mock = mockStyleApp({ frame: {} });
    const router = new RPCRouter(mock.app);
    const response = await router.execute(
      request("view.set_style", {
        style: "skeletal",
        outline: true,
        atoms: { radius: 1.2 },
        bonds: { radius: 0.8 },
      }),
    );

    expect(response.content.error).toBeUndefined();
    expect(mock.representation.id).toBe("skeletal");
    expect(mock.representation.outlineEnabled).toBe(true);
    expect(mock.representation.atomRadiusScale).toBe(1.2);
    expect(mock.representation.bondRadiusScale).toBe(0.8);
    // The bug was 2–3 fullRebuilds; must be exactly one.
    expect(mock.pipelineCalls).toBe(1);
    expect(mock.redrawCalls).toBe(0);
  });

  it("redraws scene-index path once when there is no HEAD frame", async () => {
    const mock = mockStyleApp({ frame: undefined });
    const router = new RPCRouter(mock.app);
    await router.execute(request("view.set_style", { style: "spacefill" }));
    expect(mock.pipelineCalls).toBe(0);
    expect(mock.redrawCalls).toBe(1);
  });
});
