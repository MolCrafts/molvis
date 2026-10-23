import { describe, expect, it } from "@rstest/core";
import {
  isRpcMethodName,
  listRpcMethods,
  RPC_METHODS,
} from "../../../src/transport/rpc/catalog";

describe("RPC catalog", () => {
  it("lists the catalog methods", () => {
    const listed = listRpcMethods();
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
