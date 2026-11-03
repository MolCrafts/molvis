/**
 * Reconstruct a real molrs `Frame` from a `FrameMessage` payload received
 * from the trajectory worker.
 *
 * This is the worker-boundary counterpart to `transport/rpc/wire.ts`, which
 * does the same job for the RPC envelope. The two differ in what they are
 * handed: a `FrameMessage` arrives structured-cloned, so its columns are
 * already typed arrays and there is no buffer-ref indirection, no carrier
 * checking, and no encode direction to mirror. Schema judgment belongs to
 * neither — `Validator::canonical` runs molrs-side.
 *
 * The returned `Frame` owns its WASM memory, but no consumer on this path
 * frees it explicitly. Both `Trajectory` caches — the async LRU and the
 * retention-capped head (`dropOldestFrame`) — only drop their reference on
 * eviction, because canvas consumers (`AtomSource`, `SceneIndex`, `Artist`)
 * can still be bound to a frame the cache is done with. The wasm-bindgen
 * `FinalizationRegistry` reclaims the WASM memory once nothing holds the
 * wrapper. `Trajectory.dispose()` likewise drops its owned references.
 */

import { Box, Cell, Frame, type MetaValue } from "@molcrafts/molvis-core/molrs";
import type { BlockPayload, ColumnPayload, FrameMessage } from "./protocol";

/** Build a real molrs `Frame` from a worker payload. */
export function rehydrateFrame(msg: FrameMessage, previous?: Frame): Frame {
  const frame = new Frame();
  const present = new Set(msg.blocks.map((block) => block.name));

  for (const block of msg.blocks) {
    const handle = frame.createBlock(block.name);
    if (block.shape) handle.setShape(Array.from(block.shape));
    for (const col of block.columns) {
      switch (col.dtype) {
        case "f64":
        case "i8":
        case "i16":
        case "i32":
        case "i64":
        case "u8":
        case "u16":
        case "u32":
        case "u64":
        case "bool":
        case "string":
          handle.set(col.name, col.data, col.shape);
          if (handle.dtype(col.name) !== col.dtype)
            throw new Error(
              `rehydrateFrame: carrier does not preserve dtype '${col.dtype}' for '${block.name}.${col.name}'`,
            );
          break;
        default: {
          // `ColumnPayload` is a closed union, so this is unreachable today and
          // the `never` binding makes adding a variant a compile error. It
          // still throws rather than falling through: dropping the column
          // would hand back a Frame that is silently missing data, and the
          // caller (`runtime.onFrame`) already turns a throw into a rejected
          // frame request.
          const unknown: never = col;
          throw new Error(
            `rehydrateFrame: unknown column dtype ${JSON.stringify(
              (unknown as { dtype?: unknown }).dtype,
            )} for column ${JSON.stringify(
              (unknown as { name?: unknown }).name,
            )} in block ${JSON.stringify(block.name)}`,
          );
        }
      }
    }
  }

  if (previous) {
    for (const name of previous.keys()) {
      if (present.has(name) || msg.sectionUpdates?.[name] === undefined)
        continue;
      const src = previous.has(name) ? previous.get(name) : undefined;
      if (src) frame.set(name, src);
    }
  }

  if (msg.box) {
    // Worker wire and Box.h() / Cell.matrix share the same row-major layout.
    frame.box = new Box(Cell.matrix(msg.box.h), msg.box.origin, msg.box.pbc);
  }

  if (msg.meta) {
    for (const [name, value] of Object.entries(msg.meta)) {
      frame.setMeta(name, value);
    }
  }

  if (msg.metaText) {
    for (const [name, value] of Object.entries(msg.metaText)) {
      frame.setMeta(name, value);
    }
  }

  return frame;
}

/** Worker-side extras riding along with an encoded frame. */
export interface EncodeFrameExtras {
  /** mrec section update ids of this frame (`FrameMessage.sectionUpdates`). */
  sectionUpdates?: Record<string, number>;
  /**
   * Section update ids of this request's retained host Frame. Unchanged
   * non-atoms blocks are omitted and copied from that exact Frame at decode.
   */
  previousSectionUpdates?: Record<string, number>;
}

/**
 * Encode a worker-side molrs `Frame` as a transferable {@link FrameMessage} —
 * the inverse of {@link rehydrateFrame}, for the worker's readers (molrs
 * `*Stream.parseRangeInInput`, mrec `MrecReader`). Every column
 * is copied out of wasm into a JS-owned typed array, so the caller may free
 * the source Frame the moment this returns.
 *
 * Columns retain their storage width and per-row shape. Unsupported complex
 * values and attributes without a Block.set counterpart fail explicitly.
 */
export function encodeFrame(
  frame: Frame,
  frameId: number,
  extras: EncodeFrameExtras = {},
): FrameMessage {
  const blocks: BlockPayload[] = [];
  const previousUpdates = extras.previousSectionUpdates;
  const currentUpdates = extras.sectionUpdates;
  for (const name of frame.keys()) {
    const block = frame.get(name);
    if (
      name !== "atoms" &&
      previousUpdates &&
      currentUpdates &&
      previousUpdates[name] !== undefined &&
      previousUpdates[name] === currentUpdates[name]
    ) {
      continue;
    }
    const columns: ColumnPayload[] = [];
    for (const key of block.keys()) {
      const dtype = block.dtype(key);
      if (dtype === "c64" || dtype === "c128")
        throw new Error(
          `encodeFrame: unsupported dtype '${dtype}' for '${name}.${key}'`,
        );
      if (
        block.validity(key) !== undefined ||
        block.precision(key) !== undefined ||
        block.target(key) !== undefined
      ) {
        throw new Error(
          `encodeFrame: cannot preserve validity, precision or target for '${name}.${key}'`,
        );
      }
      const shape = block.shape(key);
      if (dtype === "bool" && shape.some((n) => n === 0))
        throw new Error(
          `encodeFrame: cannot preserve empty bool column '${name}.${key}'`,
        );
      columns.push({
        name: key,
        dtype,
        data: block.copy(key),
        shape,
      } as ColumnPayload);
    }

    const shape = block.structuralShape;
    blocks.push(
      shape && shape.length > 1
        ? { name, columns, shape: Uint32Array.from(shape) }
        : { name, columns },
    );
  }

  // Structured clone preserves bigint, typed arrays, and JSON metadata.
  // Keep text in its existing field; carry every other stored value as-is.
  const meta: Record<string, MetaValue> = {};
  const metaText: Record<string, string> = {};
  let hasMeta = false;
  let hasMetaText = false;
  for (const name of frame.metaKeys()) {
    const value = frame.getMeta(name);
    if (value === undefined) continue;
    if (typeof value !== "string") {
      meta[name] = value;
      hasMeta = true;
      continue;
    }
    metaText[name] = value;
    hasMetaText = true;
  }

  return {
    kind: "frame",
    frameId,
    blocks,
    box: encodeBox(frame.box),
    ...(hasMeta ? { meta } : {}),
    ...(hasMetaText ? { metaText } : {}),
    ...(extras.sectionUpdates ? { sectionUpdates: extras.sectionUpdates } : {}),
  };
}

/**
 * Copy a Box into the wire shape. `frame.box` is a getter clone — free it
 * after copying `h`/`origin` out, or every streamed frame leaks a wasm Box.
 */
function encodeBox(box: Box | undefined): FrameMessage["box"] {
  if (!box) return null;
  const hArr = box.h();
  const originArr = box.origin();
  try {
    return {
      h: hArr.toCopy(),
      origin: originArr.toCopy(),
      pbc: box.pbc(),
    };
  } finally {
    hArr.free();
    originArr.free();
    box.free();
  }
}
