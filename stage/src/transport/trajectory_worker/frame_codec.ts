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
 * wrapper. `Trajectory.dispose()` is the one place an explicit `free()` is
 * safe, because it runs when nothing can still be looking.
 */

import { type Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { DType } from "../../utils/dtype";
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
          handle.set(col.name, col.data);
          break;
        case "u64":
          handle.set(col.name, col.data);
          break;
        case "i32":
          handle.set(col.name, col.data);
          break;
        case "string":
          handle.set(col.name, col.data);
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
      if (present.has(name)) continue;
      const src = previous.has(name) ? previous.get(name) : undefined;
      if (src) copyBlockInto(frame, name, src);
    }
  }

  if (msg.box) {
    frame.box = new Box(
      msg.box.h,
      msg.box.origin,
      msg.box.pbc[0],
      msg.box.pbc[1],
      msg.box.pbc[2],
    );
  }

  if (msg.meta) {
    for (const [name, value] of Object.entries(msg.meta)) {
      frame.setMetaScalar(name, value);
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
   * Previous frame's section update ids. Unchanged non-atoms blocks are
   * omitted from the payload so the main thread can reuse the last Frame's
   * Block handles.
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
 * Column dtypes follow the wire union: float columns travel as f64, unsigned
 * ids as u64, `int` and string columns as-is. Any other dtype (bool / u8) is
 * dropped.
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
      if (dtype === DType.Float) {
        columns.push({
          name: key,
          dtype: "f64",
          data: block.copy(key) as Float64Array,
        });
      } else if (dtype === DType.Uint) {
        columns.push({
          name: key,
          dtype: "u64",
          data: block.copy(key) as BigUint64Array,
        });
      } else if (dtype === DType.Int) {
        columns.push({
          name: key,
          dtype: "i32",
          data: block.copy(key) as Int32Array,
        });
      } else if (dtype === DType.String) {
        // A plain array: molrs tags a string copy with its shape / dtype.
        columns.push({
          name: key,
          dtype: "string",
          data: Array.from(block.copy(key) as string[]),
        });
      }
    }
    const shape = block.structuralShape;
    blocks.push(
      shape && shape.length > 1
        ? { name, columns, shape: Uint32Array.from(shape) }
        : { name, columns },
    );
  }

  // Numeric and string meta are separate dtypes with separate getters; a
  // key is one or the other, never both, so each name lands in exactly one
  // of these maps.
  const meta: Record<string, number> = {};
  const metaText: Record<string, string> = {};
  let hasMeta = false;
  let hasMetaText = false;
  for (const name of frame.metaKeys()) {
    const value = frame.getMetaScalar(name);
    if (value !== undefined) {
      meta[name] = value;
      hasMeta = true;
      continue;
    }
    const text = frame.getMeta(name);
    if (text === undefined) continue;
    metaText[name] = text;
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
    const pbc = box.pbc();
    return {
      h: hArr.toCopy(),
      origin: originArr.toCopy(),
      pbc: [Boolean(pbc[0]), Boolean(pbc[1]), Boolean(pbc[2])],
    };
  } finally {
    hArr.free();
    originArr.free();
    box.free();
  }
}

function copyBlockInto(target: Frame, name: string, source: Block): void {
  const handle = target.createBlock(name);
  const shape = source.structuralShape;
  if (shape && shape.length > 1) handle.setShape(shape);
  for (const key of source.keys()) {
    const dtype = source.dtype(key);
    if (
      dtype === DType.Float ||
      dtype === DType.Uint ||
      dtype === DType.Int ||
      dtype === DType.String
    ) {
      handle.set(
        key,
        source.copy(key) as
          | Float64Array
          | BigUint64Array
          | Int32Array
          | string[],
      );
    }
  }
}
