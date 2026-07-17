import { describe, expect, it } from "@rstest/core";
import type { MolvisApp } from "../src/app";
import type { RepresentationId } from "../src/artist/representation";
import { RPCRouter } from "../src/transport/rpc/router";

function request(method: string, params: Record<string, unknown>) {
  return { jsonrpc: "2.0", id: 1, method, params };
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
    let selected: RepresentationId | undefined;
    const app = {
      frame: undefined,
      setRepresentation: async (id: RepresentationId) => {
        selected = id;
      },
    } as MolvisApp;
    const router = new RPCRouter(app);
    const response = await router.execute(
      request("view.set_style", { style: "tube" }),
    );

    expect(response.content.error).toBeUndefined();
    expect(selected).toBe("tube");
  });

  it("routes the optional 2-D outline through global style state", async () => {
    let outlined: boolean | undefined;
    const app = {
      frame: undefined,
      setRepresentation: async () => {},
      setRepresentationOutline: async (enabled: boolean) => {
        outlined = enabled;
      },
    } as unknown as MolvisApp;
    const router = new RPCRouter(app);
    const response = await router.execute(
      request("view.set_style", { style: "graph", outline: false }),
    );

    expect(response.content.error).toBeUndefined();
    expect(outlined).toBe(false);
  });
});
