/**
 * Convert between RPC EncodedFrame (side-channel buffers) and JSON-portable
 * frames (base64-inlined buffers) for project files.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import {
  decodeFrame,
  type EncodedFrame,
  encodeFrame,
} from "../transport/rpc/serialization";
import type { PortableBuffer, PortableFrame } from "./types";

function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out.buffer;
}

/** EncodedFrame → JSON-safe portable frame. */
export function encodedToPortable(encoded: EncodedFrame): PortableFrame {
  const buffers: PortableBuffer[] = encoded.buffers.map((buf) => ({
    base64: bytesToBase64(buf),
  }));
  return {
    blocks: encoded.frame.blocks as Record<string, unknown>,
    box: encoded.frame.box,
    buffers,
  };
}

/** Portable frame → molrs Frame (caller owns free). */
export function portableToFrame(
  portable: PortableFrame,
  context: string,
): Frame {
  const views = portable.buffers.map(
    (b) => new DataView(base64ToBytes(b.base64)),
  );
  const payload = {
    blocks: portable.blocks,
    ...(portable.box !== undefined ? { box: portable.box } : {}),
  };
  return decodeFrame(payload, views, context);
}

/** molrs Frame → portable (for project export). */
export function frameToPortable(frame: Frame): PortableFrame {
  return encodedToPortable(encodeFrame(frame, "project.export"));
}
