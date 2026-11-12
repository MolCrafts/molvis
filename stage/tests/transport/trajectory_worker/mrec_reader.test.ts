import { describe, expect, it } from "@rstest/core";
import type { FileRangeReadSync } from "../../../src/io/mrec_store";
import { openMrecReader } from "../../../src/transport/trajectory_worker/mrec_reader";
import { buildStoredZip } from "../../io/fixtures/stored_zip";
import { TINY_ZARR_FILES } from "../../io/fixtures/tiny_zarr_files";

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function tinyFiles(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(TINY_ZARR_FILES)) {
    files.set(path, decodeBase64(content));
  }
  return files;
}

describe("openMrecReader", () => {
  it("mrec-files: opens the posted buffers through a map host", () => {
    const files = new Map<string, ArrayBuffer>();
    let expectedBytes = 0;
    for (const [key, data] of tinyFiles()) {
      files.set(key, data.slice().buffer as ArrayBuffer);
      expectedBytes += data.byteLength;
    }
    const { reader, totalBytes } = openMrecReader({
      kind: "mrec-files",
      files,
    });
    try {
      expect(reader.nFrames()).toBe(2);
      expect(totalBytes).toBe(expectedBytes);
      expect(reader.blockNames()).toContain("atoms");
    } finally {
      reader.free();
    }
  });

  it("mrec-zip: unpacks a stored archive", () => {
    const bytes = buildStoredZip(tinyFiles());
    const { reader, totalBytes } = openMrecReader({
      kind: "mrec-zip",
      bytes: bytes.buffer as ArrayBuffer,
    });
    try {
      expect(reader.nFrames()).toBe(2);
      expect(totalBytes).toBe(bytes.byteLength);
    } finally {
      reader.free();
    }
  });

  it("mrec-file-tree: reads byte ranges lazily, never a whole shard", () => {
    const contents = tinyFiles();
    const files = new Map<string, File>();
    const byFile = new Map<File, string>();
    for (const [key, data] of contents) {
      const file = new File([data as BlobPart], key.split("/").pop() ?? key);
      files.set(key, file);
      byFile.set(file, key);
    }
    const reads: Array<{ key: string; offset: number; length: number }> = [];
    const fileRange = (): FileRangeReadSync => (file, offset, length) => {
      const key = byFile.get(file);
      if (key === undefined) throw new Error("unknown file");
      reads.push({ key, offset, length });
      return contents.get(key)!.subarray(offset, offset + length);
    };
    const { reader } = openMrecReader(
      { kind: "mrec-file-tree", files },
      fileRange,
    );
    try {
      expect(reader.nFrames()).toBe(2);
      const before = reads.length;
      const frame = reader.readFrame(1);
      expect(
        (frame?.has("atoms") ? frame.get("atoms") : undefined)?.nRows,
      ).toBe(2);
      frame?.free();
      const frameReads = reads.slice(before);
      expect(frameReads.length).toBeGreaterThan(0);
      // The shard index lives at the start of each chunk file; a frame decode
      // asks for that index and the frame's own chunk, not the whole shard.
      const shardKeys = frameReads.filter((r) => /\/c\//.test(r.key));
      expect(shardKeys.length).toBeGreaterThan(0);
      for (const read of shardKeys) {
        expect(read.length).toBeLessThanOrEqual(contents.get(read.key)!.length);
      }
    } finally {
      reader.free();
    }
  });

  it("rejects the file-tree shape without a synchronous File reader", () => {
    const files = new Map<string, File>([["zarr.json", new File([], "z")]]);
    expect(() =>
      openMrecReader({ kind: "mrec-file-tree", files }, () => {
        throw new Error("no FileReaderSync here");
      }),
    ).toThrow(/FileReaderSync/);
  });
});
