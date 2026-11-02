/**
 * Frames in project files: molrs Frame bytes, base64-inlined so the document
 * stays JSON.
 *
 * The bytes are exactly what crosses the RPC seam (`writeEncodedFrame` /
 * `readEncodedFrame`), so a project file stores a Frame the one way molrs writes
 * it — blocks, columns with dtypes and validity masks, box and meta.
 */

import {
  type Frame,
  readEncodedFrame,
  writeEncodedFrame,
} from "@molcrafts/molvis-core/molrs";
import { FRAME_FORMAT } from "../transport/rpc/types";
import type { PortableFrame } from "./types";

function bytesToBase64(view: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Portable frame → molrs Frame (caller owns free).
 *
 * @throws {Error} naming `context` when molrs cannot read the bytes.
 */
export function portableToFrame(
  portable: PortableFrame,
  context: string,
): Frame {
  try {
    return readEncodedFrame(base64ToBytes(portable.base64), portable.format);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${context}: ${detail}`);
  }
}

/** molrs Frame → portable (for project export). */
export function frameToPortable(frame: Frame): PortableFrame {
  return {
    format: FRAME_FORMAT,
    base64: bytesToBase64(writeEncodedFrame(frame, FRAME_FORMAT)),
  };
}
