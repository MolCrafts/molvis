import { describe, expect, it } from "@rstest/core";
import {
  type CachedIndexInput,
  decideMolidxUse,
  decodeMolidx,
  encodeMolidx,
  MOLIDX_VERSION,
  STAGE_INDEXER_VERSION,
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
    expect(decoded?.molidxVersion).toBe(MOLIDX_VERSION);
    expect(decoded?.complete).toBe(true);
    expect(decoded?.fileSize).toBe(original.totalBytes);
  });

  it("writes version word 2", () => {
    const encoded = encodeMolidx(fixture());
    expect(new DataView(encoded).getUint32(4, true)).toBe(2);
  });

  it("returns null for a previous-layout version word", () => {
    const encoded = encodeMolidx(fixture());
    new DataView(encoded).setUint32(4, 1, true);
    expect(decodeMolidx(encoded)).toBeNull();
  });

  it("returns null for an unknown version", () => {
    const encoded = encodeMolidx(fixture());
    new DataView(encoded).setUint32(4, 99, true);
    expect(decodeMolidx(encoded)).toBeNull();
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

  it("pins STAGE_INDEXER_VERSION at 1", () => {
    expect(STAGE_INDEXER_VERSION).toBe(1);
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
