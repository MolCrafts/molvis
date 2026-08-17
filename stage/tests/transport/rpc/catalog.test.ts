import { describe, expect, it } from "@rstest/core";
import {
  isRpcMethodName,
  listRpcMethods,
  RPC_METHODS,
  RPC_PROTOCOL_VERSION,
} from "../../../src/transport/rpc/catalog";

describe("RPC catalog", () => {
  it("lists a stable protocol version and methods", () => {
    const listed = listRpcMethods();
    expect(listed.version).toBe(RPC_PROTOCOL_VERSION);
    expect(listed.methods).toEqual([...RPC_METHODS]);
    expect(listed.methods).toContain("rpc.list_methods");
    expect(listed.methods).toContain("scene.draw_frame");
  });

  it("isRpcMethodName narrows known methods", () => {
    expect(isRpcMethodName("scene.clear")).toBe(true);
    expect(isRpcMethodName("nope.method")).toBe(false);
  });

  it("has unique method names", () => {
    expect(new Set(RPC_METHODS).size).toBe(RPC_METHODS.length);
  });
});
