/**
 * `.molidx` binary codec — compact serialization of MolRS
 * `FrameIndexEntry[]` (byteOffset + byteLen, bytes) for OPFS.
 *
 * This is a cache of an already-built frame table, not a trajectory
 * format and not part of MolRS.
 *
 * Layout (the only one; a buffer that is not this layout is a miss):
 *
 *   magic            u32   "MIDX"
 *   formatId         u32
 *   flags            u32   bit 0 = complete
 *   nframes          u32
 *   fileSize         u64   source length in bytes
 *   scannedBytes     u64   bytes consumed by the last emitted frame
 *   identityKind     u32   0 = legacy, 1 = mtime, 2 = head-tail
 *   mtimeMs          u64
 *   headHash         u64
 *   tailHash         u64
 *   entries          nframes × { byteOffset: u64, byteLen: u32 }
 *
 * Bad magic / truncate / unknown formatId → `null`. Nothing gates
 * compatibility before 1.0.0, so a sidecar from another layout is a miss.
 */

import type { StreamFormat } from "../../transport/trajectory_worker/protocol";

export type MolidxIdentity =
  | { kind: "legacy" }
  | { kind: "mtime"; mtimeMs: number }
  | { kind: "head-tail"; headHash: number; tailHash: number };

export interface FrameIndexLike {
  byteOffset: number;
  byteLen: number;
}

/**
 * Decoded sidecar. `totalBytes` equals `fileSize` — kept so existing
 * callers that only read `totalBytes` keep working.
 */
export interface CachedIndex {
  format: StreamFormat;
  fileSize: number;
  totalBytes: number;
  identity: MolidxIdentity;
  scannedBytes: number;
  indexedFrames: number;
  complete: boolean;
  entries: FrameIndexLike[];
}

/** Write input; omitted fields get complete/legacy defaults. */
export interface CachedIndexInput {
  format: StreamFormat;
  fileSize?: number;
  totalBytes?: number;
  identity?: MolidxIdentity;
  scannedBytes?: number;
  complete?: boolean;
  entries: FrameIndexLike[];
}

export type MolidxUse =
  | { action: "miss" }
  | { action: "hit"; index: CachedIndex }
  | { action: "resume"; index: CachedIndex; scannedBytes: number };

const MAGIC = 0x5849444d;
const HEADER_BYTES = 4 + 4 + 4 + 4 + 8 + 8 + 4 + 8 + 8 + 8;
const ENTRY_BYTES = 8 + 4;
const FLAG_COMPLETE = 1;

const FORMAT_TO_ID: Record<StreamFormat, number> = {
  "lammps-dump": 1,
  xyz: 2,
  pdb: 3,
  lammps: 4,
  sdf: 5,
  dcd: 6,
  xtc: 7,
  trr: 8,
};

const ID_TO_FORMAT: Record<number, StreamFormat> = (() => {
  const out: Record<number, StreamFormat> = {};
  for (const [k, v] of Object.entries(FORMAT_TO_ID)) out[v] = k as StreamFormat;
  return out;
})();

function fileSizeOf(idx: CachedIndexInput): number {
  return idx.fileSize ?? idx.totalBytes ?? 0;
}

/**
 * Normalize a write payload into the record `encodeMolidx` persists.
 *
 * Units: `fileSize` / `scannedBytes` / entry offsets are **bytes**.
 */
export function normalizeCachedIndex(idx: CachedIndexInput): CachedIndex {
  const fileSize = fileSizeOf(idx);
  const entries = idx.entries;
  const last = entries[entries.length - 1];
  const scannedFromEntries =
    last === undefined ? 0 : last.byteOffset + last.byteLen;
  const complete = idx.complete ?? true;
  return {
    format: idx.format,
    fileSize,
    totalBytes: fileSize,
    identity: idx.identity ?? { kind: "legacy" },
    scannedBytes:
      idx.scannedBytes ?? (complete ? fileSize : scannedFromEntries),
    indexedFrames: entries.length,
    complete,
    entries,
  };
}

/**
 * Encode a frame table as molidx.
 *
 * @param idx - Frame table. Offsets and `fileSize` are bytes.
 * @returns Little-endian ArrayBuffer ready for OPFS.
 */
export function encodeMolidx(idx: CachedIndexInput): ArrayBuffer {
  const rec = normalizeCachedIndex(idx);
  const formatId = FORMAT_TO_ID[rec.format];
  if (formatId === undefined) {
    throw new Error(`molidx encode: unknown format '${rec.format}'`);
  }
  const buf = new ArrayBuffer(HEADER_BYTES + rec.entries.length * ENTRY_BYTES);
  const dv = new DataView(buf);
  let p = 0;
  dv.setUint32(p, MAGIC, true);
  p += 4;
  dv.setUint32(p, formatId, true);
  p += 4;
  dv.setUint32(p, rec.complete ? FLAG_COMPLETE : 0, true);
  p += 4;
  dv.setUint32(p, rec.entries.length, true);
  p += 4;
  dv.setBigUint64(p, BigInt(rec.fileSize), true);
  p += 8;
  dv.setBigUint64(p, BigInt(rec.scannedBytes), true);
  p += 8;
  const identity = rec.identity;
  if (identity.kind === "mtime") {
    dv.setUint32(p, 1, true);
    p += 4;
    dv.setBigUint64(p, BigInt(identity.mtimeMs), true);
    p += 8;
    dv.setBigUint64(p, 0n, true);
    p += 8;
    dv.setBigUint64(p, 0n, true);
    p += 8;
  } else if (identity.kind === "head-tail") {
    dv.setUint32(p, 2, true);
    p += 4;
    dv.setBigUint64(p, 0n, true);
    p += 8;
    dv.setBigUint64(p, BigInt(identity.headHash), true);
    p += 8;
    dv.setBigUint64(p, BigInt(identity.tailHash), true);
    p += 8;
  } else {
    dv.setUint32(p, 0, true);
    p += 4;
    dv.setBigUint64(p, 0n, true);
    p += 8;
    dv.setBigUint64(p, 0n, true);
    p += 8;
    dv.setBigUint64(p, 0n, true);
    p += 8;
  }
  for (const e of rec.entries) {
    dv.setBigUint64(p, BigInt(e.byteOffset), true);
    p += 8;
    dv.setUint32(p, e.byteLen, true);
    p += 4;
  }
  return buf;
}

/**
 * Decode a `.molidx` buffer. Only this layout is accepted — anything
 * else is a miss and the caller re-indexes.
 */
export function decodeMolidx(buf: ArrayBuffer): CachedIndex | null {
  if (buf.byteLength < 4) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) return null;
  return decodeBody(dv, buf.byteLength);
}

function decodeEntries(
  dv: DataView,
  start: number,
  nframes: number,
): FrameIndexLike[] {
  const entries: FrameIndexLike[] = new Array(nframes);
  let p = start;
  for (let i = 0; i < nframes; i++) {
    const byteOffset = Number(dv.getBigUint64(p, true));
    p += 8;
    const byteLen = dv.getUint32(p, true);
    p += 4;
    entries[i] = { byteOffset, byteLen };
  }
  return entries;
}

function decodeBody(dv: DataView, byteLength: number): CachedIndex | null {
  if (byteLength < HEADER_BYTES) return null;
  let p = 4;
  const formatId = dv.getUint32(p, true);
  p += 4;
  const flags = dv.getUint32(p, true);
  p += 4;
  const nframes = dv.getUint32(p, true);
  p += 4;
  const fileSize = Number(dv.getBigUint64(p, true));
  p += 8;
  const scannedBytes = Number(dv.getBigUint64(p, true));
  p += 8;
  const identityKind = dv.getUint32(p, true);
  p += 4;
  const mtimeMs = Number(dv.getBigUint64(p, true));
  p += 8;
  const headHash = Number(dv.getBigUint64(p, true));
  p += 8;
  const tailHash = Number(dv.getBigUint64(p, true));
  p += 8;
  if (byteLength !== HEADER_BYTES + nframes * ENTRY_BYTES) return null;
  const format = ID_TO_FORMAT[formatId];
  if (!format) return null;
  const entries = decodeEntries(dv, p, nframes);
  let identity: MolidxIdentity = { kind: "legacy" };
  if (identityKind === 1) identity = { kind: "mtime", mtimeMs };
  else if (identityKind === 2)
    identity = { kind: "head-tail", headHash, tailHash };
  return {
    format,
    fileSize,
    totalBytes: fileSize,
    identity,
    scannedBytes,
    indexedFrames: entries.length,
    complete: (flags & FLAG_COMPLETE) !== 0,
    entries,
  };
}

/**
 * Decide whether a decoded sidecar can skip, resume, or must miss.
 *
 * Incomplete tables never `hit`. Resume `scannedBytes` is the end of
 * the last complete `FramePos` (bytes). `scannedBytes >= fileSize` on
 * an incomplete table is `miss`.
 */
export function decideMolidxUse(
  cached: CachedIndex | null,
  fileSize: number,
  format: StreamFormat,
): MolidxUse {
  if (!cached) return { action: "miss" };
  if (cached.format !== format) return { action: "miss" };
  if (cached.fileSize !== fileSize) return { action: "miss" };
  if (!cached.complete) {
    const last = cached.entries[cached.entries.length - 1];
    if (!last) return { action: "miss" };
    const scannedBytes = last.byteOffset + last.byteLen;
    if (scannedBytes >= fileSize) return { action: "miss" };
    return { action: "resume", index: cached, scannedBytes };
  }
  return { action: "hit", index: cached };
}
