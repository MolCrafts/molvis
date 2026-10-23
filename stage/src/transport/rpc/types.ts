/**
 * RPC type definitions for the WebSocket bridge.
 *
 * JSON-RPC 2.0 with a binary extension: binary payloads travel as separate
 * buffers, referenced from the JSON by a {@link BufferRef}. A molecular payload
 * is one such buffer holding molrs Frame bytes ({@link FRAME_FORMAT}); its
 * layout is molrs's, and nothing in molvis defines it.
 */

/** Marker key identifying a {@link BufferRef} inside a JSON payload. */
export const BUFFER_REF_MARKER = "__molvis_buffer__";

/**
 * The encoding every Frame crosses a molvis seam in — the RPC seam and the
 * trajectory worker ↔ main-thread channel alike: molrs's own Frame bytes,
 * written by `writeEncodedFrame` / `molrs.io.write_msgpack_frame_bytes` and read by
 * `readEncodedFrame` / `molrs.io.read_msgpack_frame_bytes`. Blocks, columns with their
 * dtypes and validity masks, the box and the meta all travel inside it.
 */
export const FRAME_FORMAT = "msgpack";

/**
 * Reference to a binary buffer carried alongside the JSON envelope.
 *
 * Over the WebSocket the buffers ride the binary-frame side channel; the
 * in-process (Pyodide) transport has no side channel and puts the bytes
 * themselves (a `Uint8Array`) where the reference would be.
 */
export interface BufferRef {
  readonly [BUFFER_REF_MARKER]: true;
  /** Index into the transport's buffer list. */
  readonly index: number;
}

export interface JsonRPCRequest {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id: number;
}

export interface JsonRPCResponse {
  jsonrpc: "2.0";
  id: number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface RPCResponseEnvelope {
  content: JsonRPCResponse;
  buffers?: ArrayBuffer[];
}

export function createSuccessResponse(
  id: number | null,
  result: unknown,
): JsonRPCResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

/**
 * JSON-RPC 2.0 §5: when the id cannot be determined (parse error, malformed
 * request) the response id is `null`, not a made-up `0`.
 */
export function createErrorResponse(
  id: number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRPCResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, data },
  };
}
