import { describe, expect, it } from "@rstest/core";
import {
  decodeBinaryFrame,
  encodeBinaryFrame,
} from "../../src/transport/ws_bridge";

describe("decodeBinaryFrame", () => {
  it("round-trips a JSON payload with no buffers", () => {
    const encoded = encodeBinaryFrame({ jsonrpc: "2.0", id: 1 }, []);
    const { json, buffers } = decodeBinaryFrame(encoded);
    expect(json).toEqual({ jsonrpc: "2.0", id: 1 });
    expect(buffers).toHaveLength(0);
  });

  it("round-trips a JSON payload with one buffer", () => {
    const payload = new Uint8Array([1, 2, 3, 4]).buffer;
    const encoded = encodeBinaryFrame({ method: "x" }, [payload]);
    const { json, buffers } = decodeBinaryFrame(encoded);
    expect(json).toEqual({ method: "x" });
    expect(buffers).toHaveLength(1);
    expect(buffers[0].byteLength).toBe(4);
    expect(buffers[0].getUint8(0)).toBe(1);
  });

  it("rejects a frame too short to hold a buffer count", () => {
    expect(() => decodeBinaryFrame(new ArrayBuffer(2))).toThrow();
  });

  it("rejects a buffer count whose header overflows the payload", () => {
    // bufferCount = 1000 → header would need 8004 bytes, far past the 4-byte buf.
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, 1000, true);
    expect(() => decodeBinaryFrame(buf)).toThrow();
  });

  it("rejects a buffer table whose lengths exceed the payload", () => {
    // 1 buffer claiming length 9999 in an 8-byte total frame.
    const buf = new ArrayBuffer(12);
    const view = new DataView(buf);
    view.setUint32(0, 1, true); // bufferCount = 1
    view.setUint32(4, 0, true); // offset = 0
    view.setUint32(8, 9999, true); // length = 9999 (overflow)
    expect(() => decodeBinaryFrame(buf)).toThrow();
  });
});
