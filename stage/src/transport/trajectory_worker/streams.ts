/**
 * MolRS constructors the trajectory worker may instantiate — the single
 * dispatch for every worker `Format`.
 *
 * Byte-range formats get a molrs `*Stream`: frame-boundary indexing
 * (`feedIndexChunk`) and one-frame decode (`parseRangeInInput`, which hands
 * back the whole `Frame`) live only in these classes. Hosts supply bytes;
 * they must not grow a parallel scanner.
 *
 * `LammpsDataStream` is a structure reader (one frame), not an N-frame
 * indexer — it is listed so `makeStream` stays the single dispatch.
 *
 * The one store format, `"mrec"`, is not a byte stream: molrs's
 * `MrecReader` owns its frame index and reads the store through a
 * synchronous key host. It is listed in {@link MOLRS_STORE_READERS} so the
 * worker's format table is complete in one place.
 */

import {
  DcdStream,
  type Frame,
  type FrameOffset,
  LammpsDataStream,
  LammpsDumpStream,
  MrecReader,
  PdbStream,
  SdfStream,
  TrrStream,
  wasmMemory,
  XtcStream,
  XyzStream,
} from "@molcrafts/molvis-core/molrs";
import type { Format, StreamFormat } from "./protocol";

/** Shared JS surface of every molrs `*Stream`. */
export type MolrsTrajStream = {
  allocInputBuffer(len: number): number;
  feedIndexChunk(globalOffset: number, len: number): FrameOffset[];
  finishIndex(): FrameOffset[];
  parseRangeInInput(offset: number, len: number): Frame;
  hintTotalBytes(total: number): void;
  decoderState(): Uint8Array | undefined;
  setDecoderState(bytes: Uint8Array): void;
  free(): void;
};

export const MOLRS_TRAJ_STREAMS: Record<
  StreamFormat,
  new () => MolrsTrajStream
> = {
  "lammps-dump": LammpsDumpStream,
  xyz: XyzStream,
  pdb: PdbStream,
  lammps: LammpsDataStream,
  sdf: SdfStream,
  dcd: DcdStream,
  xtc: XtcStream,
  trr: TrrStream,
};

/** Store formats: the molrs reader class that opens them. */
export const MOLRS_STORE_READERS = {
  mrec: MrecReader,
} as const satisfies Record<Exclude<Format, StreamFormat>, unknown>;

/** Whether `format` opens through a store reader rather than a byte stream. */
export function isStoreFormat(
  format: Format,
): format is Exclude<Format, StreamFormat> {
  return Object.hasOwn(MOLRS_STORE_READERS, format);
}

/** Construct the MolRS stream for `format`. Never a host-local parser. */
export function makeStream(format: StreamFormat): MolrsTrajStream {
  return new MOLRS_TRAJ_STREAMS[format]();
}

/**
 * Copy `bytes` into `stream`'s reusable input buffer, ready for
 * `feedIndexChunk` / `parseRangeInInput` over `[0, bytes.byteLength)`.
 */
export function writeStreamInput(
  stream: MolrsTrajStream,
  bytes: Uint8Array,
): void {
  const ptr = stream.allocInputBuffer(bytes.byteLength);
  // Derive the view after the alloc: it may have grown wasm memory and
  // detached any earlier view of it.
  new Uint8Array(wasmMemory().buffer, ptr, bytes.byteLength).set(bytes);
}

/** Plain-number copy of molrs frame offsets, each wasm handle freed. */
export function takeFrameOffsets(
  entries: FrameOffset[],
): Array<{ byteOffset: number; byteLen: number }> {
  return entries.map((entry) => {
    const pos = { byteOffset: entry.byteOffset, byteLen: entry.byteLen };
    entry.free();
    return pos;
  });
}
