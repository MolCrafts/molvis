import { describe, expect, it } from "@rstest/core";
import { SliceModifier } from "../../src/modifiers/SliceModifier";
import { ModifierPipeline } from "../../src/pipeline/pipeline";
import { SESSION_CATEGORY, Session } from "../../src/pipeline/session";
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

describe("pipeline.list with a session row", () => {
  it("serializes the session with an empty capability list", async () => {
    const pipeline = new ModifierPipeline();
    pipeline.setSession(new Session("session", "ws://x", () => {}));
    pipeline.addModifier(new SliceModifier());

    const router = new RPCRouter(fakeApp(pipeline));
    const res = await router.execute({
      jsonrpc: "2.0",
      id: 4,
      method: "pipeline.list",
      params: {},
    });

    const body = JSON.parse(JSON.stringify(res.content));
    expect(body.error).toBeUndefined();
    const rows = body.result.modifiers as Array<{
      name: string;
      category?: string;
      capabilities: string[];
    }>;
    const session = rows.find((row) => row.name === "Session");
    expect(session?.capabilities).toEqual([]);
    expect(session?.category).toBe(SESSION_CATEGORY);
    expect(rows.some((row) => row.name === "Slice")).toBe(true);
  });
});

describe("pipeline.clear and the session it arrives on", () => {
  /** `clear` reaches applyPipeline, so the fake needs that much of the app. */
  function clearableApp(pipeline: ModifierPipeline) {
    return {
      modifierPipeline: pipeline,
      applyPipeline: async () => null,
    } as never;
  }

  it("answers before the session is torn down", async () => {
    const pipeline = new ModifierPipeline();
    const order: string[] = [];
    pipeline.setSession(
      new Session("session", "ws://x", () => order.push("disconnect")),
    );

    const router = new RPCRouter(clearableApp(pipeline));
    const res = await router.execute({
      jsonrpc: "2.0",
      id: 9,
      method: "pipeline.clear",
      params: {},
    });
    order.push("replied");

    // The gate: were the session closed inside the handler, the reply would
    // have had no socket left to travel on.
    const body = JSON.parse(JSON.stringify(res.content));
    expect(body.error).toBeUndefined();
    expect(order).toEqual(["replied"]);

    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["replied", "disconnect"]);
    expect(pipeline.session()).toBeNull();
  });
});
