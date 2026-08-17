/**
 * Adapter between the RPC layer and the Frame wire codec.
 *
 * The codec itself lives in `@molcrafts/molvis-core/wire` so the page shell and
 * plugins reach the same one. All this module adds is the JSON-RPC framing: a
 * {@link WireError} becomes `-32602 Invalid params` with the offending
 * `block.column` path intact.
 *
 * What used to be here — dtype inference from JavaScript runtime types, a
 * `symbol`/`species`/`i`/`j` alias table, a required-column check for `atoms` —
 * is gone. Column names and dtypes are molrs's (`molrs::store::keys`,
 * `molrs.fields`); the producer states them and this side takes them at their
 * word.
 */

import type { Box, Frame } from "@molcrafts/molvis-core/molrs";
import {
  decodeBox as decodeWireBox,
  decodeFrame as decodeWireFrame,
  type EncodedFrame,
  encodeFrame as encodeWireFrame,
  WireError,
} from "./wire";

export type { EncodedFrame };
export { WireError };

/**
 * Thrown for a malformed molecular payload; the RPC router maps it to
 * `-32602`. Carries the wire path (`atoms.x`) so the producer can find it.
 */
export class FramePayloadError extends Error {
  readonly path: string;

  constructor(context: string, cause: WireError | Error | string) {
    const path = cause instanceof WireError ? cause.path : "";
    const detail = typeof cause === "string" ? cause : cause.message;
    super(context ? `${context}: ${detail}` : detail);
    this.name = "FramePayloadError";
    this.path = path;
  }
}

function rethrow(context: string, error: unknown): never {
  if (error instanceof WireError || error instanceof Error) {
    throw new FramePayloadError(context, error);
  }
  throw new FramePayloadError(context, String(error));
}

/**
 * Decode one `WireFrame` into a molrs `Frame`.
 *
 * @param context Human-readable location for the error message, e.g.
 *   `"scene.set_trajectory frames[2]"`.
 */
export function decodeFrame(
  payload: unknown,
  buffers: readonly DataView[],
  context = "",
): Frame {
  try {
    return decodeWireFrame(payload, buffers);
  } catch (error) {
    rethrow(context, error);
  }
}

/** Decode one `WireBox` into a molrs `Box`. */
export function decodeBox(
  payload: unknown,
  buffers: readonly DataView[],
  context = "",
): Box {
  try {
    return decodeWireBox(payload, buffers);
  } catch (error) {
    rethrow(context, error);
  }
}

/**
 * Encode a molrs `Frame` for a response.
 *
 * Emits every block and column the frame holds — there is no field whitelist,
 * so `charge`, `mol_id`, a volumetric `grid` block and the simulation box all
 * survive the trip back to the controller.
 */
export function encodeFrame(frame: Frame, context = ""): EncodedFrame {
  try {
    return encodeWireFrame(frame);
  } catch (error) {
    rethrow(context, error);
  }
}
