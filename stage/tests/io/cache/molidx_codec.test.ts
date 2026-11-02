import { describe, expect, it } from "@rstest/core";
import {
  type CachedIndexInput,
  decideMolidxUse,
  decodeMolidx,
  encodeMolidx,
} from "../../../src/io/cache/molidx_codec";

function fixture(): CachedIndexInput {
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
    expect(decoded?.complete).toBe(true);
    expect(decoded?.fileSize).toBe(original.totalBytes);
  });

  it("returns null for a sidecar that still carries a version word", () => {
    // The previous layout stored a version u32 at offset 4 (68-byte
    // header). That buffer is not this layout.
    const buf = new ArrayBuffer(68);
    const dv = new DataView(buf);
    dv.setUint32(0, 0x5849444d, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, 1, true);
    dv.setUint32(12, 1, true);
    expect(decodeMolidx(buf)).toBeNull();
  });

  it("decideMolidxUse hits a complete matching table", () => {
    const cached = decodeMolidx(encodeMolidx(fixture()));
    expect(decideMolidxUse(cached, 4096, "lammps-dump")).toEqual({
      action: "hit",
      index: cached,
    });
  });

  it("decideMolidxUse resumes an incomplete table from the last frame end", () => {
    const encoded = encodeMolidx({
      format: "xyz",
      fileSize: 4096,
      complete: false,
      entries: [
        { byteOffset: 0, byteLen: 1024 },
        { byteOffset: 1024, byteLen: 1024 },
      ],
    });
    const cached = decodeMolidx(encoded);
    expect(decideMolidxUse(cached, 4096, "xyz")).toEqual({
      action: "resume",
      index: cached,
      scannedBytes: 2048,
    });
  });

  it("decideMolidxUse misses when incomplete scannedBytes covers the file", () => {
    const cached = decodeMolidx(
      encodeMolidx({
        format: "xyz",
        fileSize: 2048,
        complete: false,
        entries: [
          { byteOffset: 0, byteLen: 1024 },
          { byteOffset: 1024, byteLen: 1024 },
        ],
      }),
    );
    expect(decideMolidxUse(cached, 2048, "xyz")).toEqual({ action: "miss" });
  });

  it("decideMolidxUse misses on format or size mismatch", () => {
    const cached = decodeMolidx(encodeMolidx(fixture()));
    expect(decideMolidxUse(cached, 4096, "xyz").action).toBe("miss");
    expect(decideMolidxUse(cached, 1, "lammps-dump").action).toBe("miss");
    expect(decideMolidxUse(null, 4096, "lammps-dump").action).toBe("miss");
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
    // Format id sits at byte offset 4, immediately after the magic.
    new DataView(encoded).setUint32(4, 999, true);
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
