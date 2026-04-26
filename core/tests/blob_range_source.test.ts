import { describe, expect, it } from "@rstest/core";
import { BlobRangeSource } from "../src/io/sources";

function blobOf(content: string): Blob {
  return new Blob([content], { type: "text/plain" });
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("BlobRangeSource", () => {
  it("exposes the blob's byte length via size()", async () => {
    const src = new BlobRangeSource(blobOf("hello world"));
    expect(await src.size()).toBe(11);
  });

  it("reads an exact byte range as Uint8Array", async () => {
    const src = new BlobRangeSource(blobOf("hello world"));
    const bytes = await src.readRange(6, 11);
    expect(decode(bytes)).toBe("world");
  });

  it("reads an empty range as a zero-length array", async () => {
    const src = new BlobRangeSource(blobOf("hello"));
    const bytes = await src.readRange(2, 2);
    expect(bytes.byteLength).toBe(0);
  });

  it("clamps an end past the blob to the blob size", async () => {
    // Blob.slice clamps silently — we rely on this instead of pre-validating.
    const src = new BlobRangeSource(blobOf("hello"));
    const bytes = await src.readRange(2, 999);
    expect(decode(bytes)).toBe("llo");
  });

  it("returns an owned Uint8Array (not a view onto the worker buffer)", async () => {
    const src = new BlobRangeSource(blobOf("abcdef"));
    const a = await src.readRange(0, 3);
    const b = await src.readRange(0, 3);
    a[0] = 0; // mutating one read must not affect the other
    expect(b[0]).toBe("a".charCodeAt(0));
  });

  it("identifies as kind: 'blob' for worker-side dispatch", () => {
    const src = new BlobRangeSource(blobOf(""));
    expect(src.kind).toBe("blob");
  });

  it("survives binary content, not just text", async () => {
    const buf = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x7f]);
    const src = new BlobRangeSource(new Blob([buf]));
    const out = await src.readRange(0, buf.byteLength);
    expect(Array.from(out)).toEqual(Array.from(buf));
  });
});
