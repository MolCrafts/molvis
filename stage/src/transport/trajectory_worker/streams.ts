/**
 * MolRS constructors the trajectory worker may instantiate — the single
 * dispatch for every worker `Format`.
 *
 * Byte-range formats get a `Wasm*Stream`: frame-boundary indexing
 * (`feedIndexChunk`) and one-frame decode (`parseRangeInInput`) live only in
 * these classes. Hosts supply bytes; they must not grow a parallel scanner.
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
  LammpsDataStream,
  LammpsDumpStream,
  MrecReader,
  PdbStream,
  SdfStream,
  TrrStream,
  XtcStream,
  XyzStream,
} from "@molcrafts/molvis-core/molrs";
import type { Format, StreamFormat } from "./protocol";

/** Shared JS surface of every `Wasm*Stream`. */
export type MolrsTrajStream = {
  allocInputBuffer(len: number): number;
  feedIndexChunk(
    globalOffset: number,
    len: number,
  ): Array<{ byteOffset: number; byteLen: number }>;
  finishIndex(): Array<{ byteOffset: number; byteLen: number }>;
  /** Decode one frame of the input buffer; the caller frees the Frame. */
  parseRangeInInput(offset: number, len: number): Frame;
  hintTotalBytes?(total: number): void;
  decoderState?(): Uint8Array | undefined;
  setDecoderState?(bytes: Uint8Array): void;
  free?(): void;
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
