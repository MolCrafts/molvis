import { describe, expect, it } from "@rstest/core";
import {
  type CachedIndex,
  decodeMolidx,
  encodeMolidx,
} from "../src/io/cache/molidx_codec";

function fixture(): CachedIndex {
  return {
    format: "lammps-dump",
    totalBytes: 4096,
    entries: [
      { byteOffset: 0, byteLen: 1024 },
      { byteOffset: 1024, byteLen: 1024 },
      { byteOffset: 2048, byteLen: 2048 },
    ],
  };
}

describe("molidx_codec", () => {
  it("round-trips a small index", () => {
    const original = fixture();
    const encoded = encodeMolidx(original);
    const decoded = decodeMolidx(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.format).toBe(original.format);
    expect(decoded?.totalBytes).toBe(original.totalBytes);
    expect(decoded?.entries).toEqual(original.entries);
  });

  it("encodes empty entries", () => {
    const encoded = encodeMolidx({
      format: "xyz",
      totalBytes: 0,
      entries: [],
    });
    const decoded = decodeMolidx(encoded);
    expect(decoded?.entries).toEqual([]);
    expect(decoded?.format).toBe("xyz");
  });

  it("preserves byteOffset above 32-bit (>4 GiB)", () => {
    // 5 GiB-ish offset
    const offset = 5 * 1024 * 1024 * 1024 + 17;
    const encoded = encodeMolidx({
      format: "pdb",
      totalBytes: offset + 256,
      entries: [{ byteOffset: offset, byteLen: 256 }],
    });
    const decoded = decodeMolidx(encoded);
    expect(decoded?.entries[0].byteOffset).toBe(offset);
  });

  it("returns null for a buffer with bad magic", () => {
    const buf = new ArrayBuffer(64);
    new DataView(buf).setUint32(0, 0xdeadbeef, true);
    expect(decodeMolidx(buf)).toBeNull();
  });

  it("returns null for a truncated buffer", () => {
    const encoded = encodeMolidx(fixture());
    // Drop the last entry's byteLen.
    expect(decodeMolidx(encoded.slice(0, encoded.byteLength - 4))).toBeNull();
  });

  it("returns null for an unknown format id", () => {
    const encoded = encodeMolidx(fixture());
    // Format id is at byte offset 8 (after magic + version).
    new DataView(encoded).setUint32(8, 999, true);
    expect(decodeMolidx(encoded)).toBeNull();
  });

  it("rejects an unknown format on encode", () => {
    expect(() =>
      encodeMolidx({
        // biome-ignore lint/suspicious/noExplicitAny: deliberate bad input
        format: "gromacs" as any,
        totalBytes: 0,
        entries: [],
      }),
    ).toThrow(/unknown format/);
  });
});
