import { describe, expect, it } from "@rstest/core";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import { Session } from "../../src/pipeline/session";
import { RPCRouter } from "../../src/transport/rpc/router";
import "../setup_wasm";

/** Minimal app surface the disabled-session gate touches. */
function fakeApp(pipeline: ModifierPipeline) {
  return { modifierPipeline: pipeline } as never;
}

const request = (id: number, method: string) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params: {} });

describe("disabled session", () => {
  it("answers with an error instead of going silent", async () => {
    const pipeline = new ModifierPipeline();
    const session = new Session("session", "ws://x", () => {});
    pipeline.setSession(session);
    session.enabled = false;

    const router = new RPCRouter(fakeApp(pipeline));
    const res = await router.execute(JSON.parse(request(1, "state.get")));

    // The point of the gate: a reply comes back, and it names the cause.
    const body = JSON.parse(JSON.stringify(res.content));
    expect(body.id).toBe(1);
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("disabled");
  });

  it("an enabled session is not gated", async () => {
    const pipeline = new ModifierPipeline();
    pipeline.setSession(new Session("session", "ws://x", () => {}));

    const router = new RPCRouter(fakeApp(pipeline));
    const res = await router.execute(
      JSON.parse(request(2, "rpc.list_methods")),
    );

    const body = JSON.parse(JSON.stringify(res.content));
    expect(body.error).toBeUndefined();
  });
});
