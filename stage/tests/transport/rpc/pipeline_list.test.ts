import { describe, expect, it } from "@rstest/core";
import type { MolvisApp } from "../../../src/app";
import { ModifierPipeline } from "../../../src/pipeline/pipeline";
import { Session } from "../../../src/pipeline/session";
import { RPCRouter } from "../../../src/transport/rpc/router";

function request(method: string) {
  return { jsonrpc: "2.0" as const, id: 1, method, params: {} };
}

describe("pipeline.list", () => {
  it("lists a Session without reading modifier capabilities", async () => {
    const pipeline = new ModifierPipeline();
    pipeline.setSession(new Session("session", "ws://local", () => {}));
    const router = new RPCRouter({
      modifierPipeline: pipeline,
    } as unknown as MolvisApp);

    const response = await router.execute(request("pipeline.list"));

    expect(response.content.error).toBeUndefined();
    const modifiers = (
      response.content.result as { modifiers: Array<Record<string, unknown>> }
    ).modifiers;
    expect(modifiers).toEqual([
      {
        id: pipeline.session()?.id,
        name: "Session",
        capabilities: [],
        enabled: true,
        selection_scope_id: null,
        source_owner_id: null,
        category: "Session",
        type_name: "Session",
        address: "ws://local",
      },
    ]);
  });
});
