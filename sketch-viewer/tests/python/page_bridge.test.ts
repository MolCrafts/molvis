import { describe, expect, it } from "@rstest/core";
import { SketchRpcError } from "../../src/python/board_rpc";
import {
  type BridgeSocket,
  SketchPageBridge,
} from "../../src/python/page_bridge";

class FakeSocket implements BridgeSocket {
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({});
  }
  deliver(data: unknown): void {
    this.onmessage?.({ data });
  }
}

const endpoint = {
  wsUrl: "ws://localhost:1/ws",
  token: "t0k",
  session: "board",
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SketchPageBridge", () => {
  it("says hello with the token and session, then waits for ready", async () => {
    const socket = new FakeSocket();
    const executed: string[] = [];
    const bridge = new SketchPageBridge(
      endpoint,
      { execute: async (method) => executed.push(method) },
      () => socket,
    );
    bridge.connect();
    socket.onopen?.({});
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "hello",
      token: "t0k",
      session: "board",
    });
    // A request before ready is not run.
    socket.deliver(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sketch.clear" }),
    );
    await flush();
    expect(executed).toEqual([]);
    socket.deliver(JSON.stringify({ type: "ready" }));
    expect(bridge.isReady).toBe(true);
  });

  it("answers requests in arrival order with results and errors", async () => {
    const socket = new FakeSocket();
    const order: string[] = [];
    const bridge = new SketchPageBridge(
      endpoint,
      {
        execute: async (method) => {
          if (method === "sketch.slow") {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          order.push(method);
          if (method === "sketch.bad")
            throw new SketchRpcError(-32602, "bad x");
          if (method === "sketch.boom") throw new Error("board refused");
          return method === "sketch.slow" ? 7 : null;
        },
      },
      () => socket,
    );
    bridge.connect();
    socket.onopen?.({});
    socket.deliver(JSON.stringify({ type: "ready" }));
    for (const [id, method] of [
      [1, "sketch.slow"],
      [2, "sketch.bad"],
      [3, "sketch.boom"],
    ] as const) {
      socket.deliver(
        JSON.stringify({ jsonrpc: "2.0", id, method, params: {} }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual(["sketch.slow", "sketch.bad", "sketch.boom"]);
    const replies = socket.sent.slice(1).map((text) => JSON.parse(text));
    expect(replies).toEqual([
      { jsonrpc: "2.0", id: 1, result: 7 },
      { jsonrpc: "2.0", id: 2, error: { code: -32602, message: "bad x" } },
      {
        jsonrpc: "2.0",
        id: 3,
        error: { code: -32603, message: "board refused" },
      },
    ]);
  });

  it("refuses binary frames instead of guessing", () => {
    const socket = new FakeSocket();
    const bridge = new SketchPageBridge(
      endpoint,
      { execute: async () => null },
      () => socket,
    );
    bridge.connect();
    socket.deliver(new ArrayBuffer(4));
    expect(JSON.parse(socket.sent[0]).error.code).toBe(-32600);
  });

  it("reads the endpoint from the page URL", () => {
    expect(
      SketchPageBridge.readEndpoint(
        "?ws_url=ws%3A%2F%2Fh%3A2%2Fws&token=a&session=s",
      ),
    ).toEqual({ wsUrl: "ws://h:2/ws", token: "a", session: "s" });
    expect(SketchPageBridge.readEndpoint("?surface=canvas")).toBeNull();
  });
});
