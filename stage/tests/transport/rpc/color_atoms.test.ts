import { describe, expect, it } from "@rstest/core";
import "../../setup_wasm";
import type { MolvisApp } from "../../../src/app";
import { AtomColorModifier } from "../../../src/modifiers/AtomColorModifier";
import type { PipelineEntry } from "../../../src/pipeline/entry";
import { RPCRouter } from "../../../src/transport/rpc/router";

function request(method: string, params: Record<string, unknown>) {
  return { jsonrpc: "2.0" as const, id: 1, method, params };
}

function mockPipelineApp() {
  const entries: PipelineEntry[] = [];
  let applied = 0;
  const app = {
    frame: undefined,
    modifierPipeline: {
      modifiers: () => entries,
      addModifier: (m: PipelineEntry) => entries.push(m),
      session: () => undefined,
    },
    applyPipeline: async () => {
      applied += 1;
      return null;
    },
  } as unknown as MolvisApp;
  return {
    app,
    entries,
    get applied() {
      return applied;
    },
  };
}

describe("view.color_atoms", () => {
  it("installs one modifier and keeps adding to it", async () => {
    const mock = mockPipelineApp();
    const router = new RPCRouter(mock.app);
    const first = await router.execute(
      request("view.color_atoms", { indices: [0, 1], color: "#0072B2" }),
    );
    expect(first.content.error).toBeUndefined();
    const second = await router.execute(
      request("view.color_atoms", { indices: [4], color: "#E69F00" }),
    );
    expect(second.content.result).toMatchObject({ colored: 3 });
    expect(mock.entries).toHaveLength(1);
    expect(mock.entries[0]).toBeInstanceOf(AtomColorModifier);
    expect(mock.applied).toBe(2);

    await router.execute(
      request("view.color_atoms", {
        indices: [2],
        color: "#009E73",
        reset: true,
      }),
    );
    expect((mock.entries[0] as AtomColorModifier).size).toBe(1);
  });

  it("rejects bad params and leaves the scene untouched", async () => {
    const mock = mockPipelineApp();
    const router = new RPCRouter(mock.app);
    for (const params of [
      { indices: [0], color: "blue" },
      { indices: [-1], color: "#000000" },
      { indices: "0", color: "#000000" },
      { indices: [0] },
    ]) {
      const reply = await router.execute(request("view.color_atoms", params));
      expect(reply.content.error).toBeDefined();
    }
    expect(mock.applied).toBe(0);
  });
});

describe("camera.fit view", () => {
  it("rejects an unknown view name", async () => {
    const router = new RPCRouter(mockPipelineApp().app);
    const reply = await router.execute(request("camera.fit", { view: "top" }));
    expect(reply.content.error?.message).toMatch(/current/);
  });
});

describe("camera.project", () => {
  it("rejects indices that are not non-negative integers", async () => {
    const router = new RPCRouter(mockPipelineApp().app);
    for (const indices of [[-1], [0.5], "0"]) {
      const reply = await router.execute(
        request("camera.project", { indices }),
      );
      expect(reply.content.error?.message).toMatch(/indices/);
    }
  });
});

describe("snapshot.take options", () => {
  it("rejects an impossible capture before touching the canvas", async () => {
    const router = new RPCRouter(mockPipelineApp().app);
    const reply = await router.execute(request("snapshot.take", { scale: 2 }));
    expect(reply.content.error?.message).toMatch(/axes/);
  });
});
