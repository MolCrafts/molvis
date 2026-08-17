/**
 * `.molidx` binary codec — compact serialization of `FrameIndexEntry[]`
 * for storage in OPFS as a sidecar to a trajectory file.
 *
 * Layout (all little-endian):
 *
 *   magic        u32   "MIDX" (0x5849444D LE)
 *   version      u32   format version, currently 1
 *   formatId     u32   numeric tag for the source format
 *   reserved     u32   zero, reserved for flags
 *   nframes      u32   frame count
 *   totalBytes   u64   trajectory byte length at index time
 *   sourceSize   u64   source file size (== totalBytes today; reserved
 *                      for the day where opfs cache and source diverge)
 *   entries      nframes × { byteOffset: u64, byteLen: u32 } (no padding)
 *
 * The codec is frozen for version 1; bump the version constant if you
 * change the layout. Decoders that see an unknown version return null
 * so the caller falls back to re-indexing.
 */

import type { Format } from "../../transport/trajectory_worker/protocol";

export interface CachedIndex {
  format: Format;
  totalBytes: number;
  entries: FrameIndexLike[];
}

export interface FrameIndexLike {
  byteOffset: number;
  byteLen: number;
}

const MAGIC = 0x5849444d;
const VERSION = 1;
const HEADER_BYTES = 4 + 4 + 4 + 4 + 4 + 8 + 8;
const ENTRY_BYTES = 8 + 4;

const FORMAT_TO_ID: Record<Format, number> = {
  "lammps-dump": 1,
  xyz: 2,
  pdb: 3,
  lammps: 4,
  sdf: 5,
};

const ID_TO_FORMAT: Record<number, Format> = (() => {
  const out: Record<number, Format> = {};
  for (const [k, v] of Object.entries(FORMAT_TO_ID)) out[v] = k as Format;
  return out;
})();

export function encodeMolidx(idx: CachedIndex): ArrayBuffer {
  const formatId = FORMAT_TO_ID[idx.format];
  if (formatId === undefined) {
    throw new Error(`molidx encode: unknown format '${idx.format}'`);
  }
  const buf = new ArrayBuffer(HEADER_BYTES + idx.entries.length * ENTRY_BYTES);
  const dv = new DataView(buf);
  let p = 0;
  dv.setUint32(p, MAGIC, true);
  p += 4;
  dv.setUint32(p, VERSION, true);
  p += 4;
  dv.setUint32(p, formatId, true);
  p += 4;
  dv.setUint32(p, 0, true); // reserved
  p += 4;
  dv.setUint32(p, idx.entries.length, true);
  p += 4;
  dv.setBigUint64(p, BigInt(idx.totalBytes), true);
  p += 8;
  dv.setBigUint64(p, BigInt(idx.totalBytes), true); // sourceSize
  p += 8;
  for (const e of idx.entries) {
    dv.setBigUint64(p, BigInt(e.byteOffset), true);
    p += 8;
    dv.setUint32(p, e.byteLen, true);
    p += 4;
  }
  return buf;
}

/**
 * Decode a `.molidx` buffer. Returns `null` for any structural mismatch
 * — wrong magic, unsupported version, truncated body, or unknown format
 * id. Callers treat null as a cache miss and re-index.
 */
export function decodeMolidx(buf: ArrayBuffer): CachedIndex | null {
  if (buf.byteLength < HEADER_BYTES) return null;
  const dv = new DataView(buf);
  let p = 0;
  if (dv.getUint32(p, true) !== MAGIC) return null;
  p += 4;
  if (dv.getUint32(p, true) !== VERSION) return null;
  p += 4;
  const formatId = dv.getUint32(p, true);
  p += 4;
  p += 4; // reserved
  const nframes = dv.getUint32(p, true);
  p += 4;
  const totalBytes = Number(dv.getBigUint64(p, true));
  p += 8;
  p += 8; // sourceSize, ignored in v1

  const expectedBytes = HEADER_BYTES + nframes * ENTRY_BYTES;
  if (buf.byteLength !== expectedBytes) return null;

  const format = ID_TO_FORMAT[formatId];
  if (!format) return null;

  const entries: FrameIndexLike[] = new Array(nframes);
  for (let i = 0; i < nframes; i++) {
    const byteOffset = Number(dv.getBigUint64(p, true));
    p += 8;
    const byteLen = dv.getUint32(p, true);
    p += 4;
    entries[i] = { byteOffset, byteLen };
  }
  return { format, totalBytes, entries };
}
