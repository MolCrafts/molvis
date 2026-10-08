/**
 * Multi-frame DCD fixtures for the trajectory-worker tests.
 *
 * ## Why this file exists, and why it is the only one of its kind
 *
 * MolRS owns trajectory IO — molvis reads `Trajectory` / `Frame` and supplies
 * byte ranges, and never re-derives a format layout. These tests honour that:
 * the frame ranges they feed back come from `DcdStream`'s own index
 * (`byteOffset` / `byteLen`), which is exactly the "hosts supply byte ranges"
 * half of the contract.
 *
 * The one exception is {@link buildMultiDcd}. MolRS publishes
 * `writeDcdBytes(frame)`, which writes a **single-frame** file, and
 * `DcdStream`, which only reads — there is no multi-frame DCD writer on the
 * WASM surface. So a multi-frame fixture has to be assembled here, and that
 * assembly needs one piece of DCD knowledge: NSET, the frame count, lives at
 * byte offset 8.
 *
 * That knowledge is quarantined to this file on purpose. It was previously
 * copy-pasted into four test files; keeping it in one place means the day
 * MolRS grows a multi-frame writer, this file is the only thing to delete.
 * Nothing under `stage/src/` knows any of it.
 */

import { toDomainUint } from "@molcrafts/molvis-core";
import {
  Block,
  DcdStream,
  Frame,
  writeDcdBytes,
} from "@molcrafts/molvis-core/molrs";
import {
  takeFrameOffsets,
  writeStreamInput,
} from "../../src/transport/trajectory_worker/streams";

/** Byte offset of NSET (`ICNTRL[0]`, the frame count) in a DCD header. */
export const DCD_NSET_OFFSET = 8;

/**
 * Build an `n`-atom frame whose coordinates are a function of `seed`, so a
 * decoded frame can be traced back to the frame it was written from.
 */
export function makeFrame(n: number, seed: number, withId = true): Frame {
  const block = new Block();
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = seed + i * 0.1;
    y[i] = seed + i * 0.2;
    z[i] = seed + i * 0.3;
  }
  if (withId) {
    const id = new Uint32Array(n);
    for (let i = 0; i < n; i++) id[i] = i + 1;
    block.set("id", toDomainUint(id));
  }
  block.set("x", x);
  block.set("y", y);
  block.set("z", z);
  const frame = new Frame();
  frame.set("atoms", block);
  return frame;
}

/** Index `bytes` with a throwaway stream and return its frame positions. */
function indexFrames(
  bytes: Uint8Array,
): Array<{ byteOffset: number; byteLen: number }> {
  const stream = new DcdStream();
  try {
    stream.hintTotalBytes(bytes.byteLength);
    writeStreamInput(stream, bytes);
    return [
      ...takeFrameOffsets(stream.feedIndexChunk(0, bytes.byteLength)),
      ...takeFrameOffsets(stream.finishIndex()),
    ];
  } finally {
    stream.free();
  }
}

/**
 * Write a one-frame DCD and split it where MolRS's own index says the frame
 * body starts — no layout knowledge of our own is involved.
 */
function singleDcd(
  seed: number,
  atomCount: number,
  withId: boolean,
): {
  bytes: Uint8Array;
  header: Uint8Array;
  frameBlock: Uint8Array;
} {
  const bytes = writeDcdBytes(makeFrame(atomCount, seed, withId));
  const pos = indexFrames(bytes)[0];
  return {
    bytes,
    header: bytes.slice(0, pos.byteOffset),
    frameBlock: bytes.slice(pos.byteOffset, pos.byteOffset + pos.byteLen),
  };
}

export interface BuildMultiDcdOptions {
  /**
   * Patch the header's frame count to match the number of frames appended.
   * Pass `false` to leave it reading `1`, which is what a DCD looks like
   * after a run appends frames without rewriting its header — the case that
   * proves a reader counts frames by scanning rather than trusting NSET.
   */
  patchNset?: boolean;
  /** Atoms per frame. Default 4. */
  atomCount?: number;
  /**
   * Write an `id` column. Default true. Pass `false` for the case where the
   * trajectory carries coordinates only and composition has to fall back to
   * row order against the topology source.
   */
  withId?: boolean;
}

/**
 * Concatenate one single-frame DCD per seed behind a shared header. See the
 * file header for why molvis has to do this at all.
 */
export function buildMultiDcd(
  seeds: number[],
  { patchNset = true, atomCount = 4, withId = true }: BuildMultiDcdOptions = {},
): Uint8Array {
  const parts = seeds.map((seed) => singleDcd(seed, atomCount, withId));
  const header = parts[0].header.slice();
  if (patchNset) {
    new DataView(header.buffer, header.byteOffset, header.byteLength).setInt32(
      DCD_NSET_OFFSET,
      seeds.length,
      true,
    );
  }

  const total =
    header.length + parts.reduce((sum, p) => sum + p.frameBlock.length, 0);
  const out = new Uint8Array(total);
  out.set(header, 0);
  let offset = header.length;
  for (const part of parts) {
    out.set(part.frameBlock, offset);
    offset += part.frameBlock.length;
  }
  return out;
}
