/**
 * Frames across the RPC seam — molrs Frame bytes, nothing of molvis's own.
 *
 * A Frame travels as one binary buffer of molrs Frame bytes
 * ({@link FRAME_FORMAT}), written by `writeEncodedFrame` and read by
 * `readEncodedFrame`; the Python controller uses the same two functions from
 * `molrs.io`. Blocks, every column with its dtype and validity mask, the box
 * and the meta are inside those bytes, so this module decides nothing about a
 * Frame's layout. All it adds is the JSON-RPC framing: where the bytes are (a
 * {@link BufferRef} into the side channel, or inline bytes from the in-process
 * transport) and a {@link FramePayloadError} — `-32602 Invalid params` — when
 * molrs refuses them.
 */

import {
  type Frame,
  readEncodedFrame,
  writeEncodedFrame,
} from "@molcrafts/molvis-core/molrs";
import { BUFFER_REF_MARKER, type BufferRef, FRAME_FORMAT } from "./types";

/**
 * Thrown for a molecular payload that is missing or that molrs cannot read;
 * the RPC router maps it to `-32602`.
 */
export class FramePayloadError extends Error {
  constructor(context: string, detail: string) {
    super(context ? `${context}: ${detail}` : detail);
    this.name = "FramePayloadError";
  }
}

/** A Frame going out: the reference that stands for it and its bytes. */
export interface EncodedFrame {
  frame: BufferRef;
  buffers: ArrayBuffer[];
}

/** molrs throws bare JS strings from wasm-bindgen as often as `Error`s. */
function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Read one Frame out of an RPC payload.
 *
 * `payload` is the JSON value standing for the Frame: a {@link BufferRef}
 * into `buffers` (WebSocket) or the bytes themselves (in-process). The
 * returned Frame owns WASM memory; the caller frees it or hands it to an
 * owner (`Trajectory`, a `DataSource`).
 *
 * @param context Human-readable location for the error message, e.g.
 *   `"scene.set_trajectory frames[2]"`.
 * @throws {FramePayloadError} when the payload is neither a reference nor
 *   bytes, the reference dangles, or molrs cannot read the bytes.
 */
export function decodeFrame(
  payload: unknown,
  buffers: readonly DataView[],
  context = "",
): Frame {
  let bytes: Uint8Array;
  if (payload instanceof Uint8Array) {
    bytes = payload;
  } else if (
    typeof payload === "object" &&
    payload !== null &&
    (payload as Record<string, unknown>)[BUFFER_REF_MARKER] === true
  ) {
    const { index } = payload as BufferRef;
    const view = buffers[index];
    if (!Number.isInteger(index) || view === undefined) {
      throw new FramePayloadError(
        context,
        `buffer index ${String(index)} is out of range (${buffers.length} buffer(s) received)`,
      );
    }
    bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  } else {
    throw new FramePayloadError(
      context,
      "expected molrs Frame bytes (a buffer reference or a Uint8Array)",
    );
  }
  try {
    return readEncodedFrame(bytes, FRAME_FORMAT);
  } catch (error) {
    throw new FramePayloadError(context, messageOf(error));
  }
}

/**
 * Write a Frame for a response: its molrs bytes as buffer 0, and the
 * reference to put in the JSON result.
 *
 * Every block, column, validity mask, the box and the meta go out — molrs
 * writes the whole Frame.
 */
export function encodeFrame(frame: Frame, context = ""): EncodedFrame {
  let bytes: Uint8Array;
  try {
    bytes = writeEncodedFrame(frame, FRAME_FORMAT);
  } catch (error) {
    throw new FramePayloadError(context, messageOf(error));
  }
  return {
    frame: { [BUFFER_REF_MARKER]: true, index: 0 },
    buffers: [
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    ],
  };
}
