/**
 * RPC type definitions for the WebSocket bridge.
 *
 * JSON-RPC 2.0 with a binary extension: dense numeric columns travel as
 * separate buffers referenced from the JSON. The shape of a molecular payload
 * is *not* defined here — it is `WireFrame` / `WireBox` in
 * `@molcrafts/molvis-core/wire`, the one definition both ends of the seam use.
 */

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
