/**
 * WebSocket bridge connecting a MolVis app to a controller (Python or
 * any other language).
 *
 * The app is a generic receiver: it dials the given `ws_url`, authenticates
 * with a token, and then drives the shared `MolvisApp`. Communication is
 * JSON-RPC 2.0 with binary-buffer framing.
 *
 * Handshake:
 *   client → server  {type:"hello", token, session}
 *   server → client  {type:"ready"}              (success)
 *                    ws.close(1008, "auth")       (token mismatch)
 *
 * Inbound: JSON-RPC requests are routed to `RPCRouter`. Responses
 * (including those carrying binary buffers) flow back over the same socket.
 *
 * Outbound events: core events (selection-change, mode-change, …) are
 * pushed as JSON-RPC notifications (no `id`) via `sendEvent`.
 */

import type { MolvisApp } from "../app";
import { RPCRouter } from "./rpc/router";
import type { RPCResponseEnvelope } from "./rpc/types";
import { createErrorResponse } from "./rpc/types";

/**
 * Decode a binary WebSocket frame into a JSON object + DataView buffers.
 *
 * Wire format:
 *   [4 bytes]  uint32 LE  buffer_count (N)
 *   [N*8 bytes] N pairs of (uint32 LE offset, uint32 LE length)
 *   [variable]  JSON payload (UTF-8)
 *   [variable]  concatenated buffer bytes
 */
export function decodeBinaryFrame(data: ArrayBuffer): {
  json: Record<string, unknown>;
  buffers: DataView[];
} {
  // Every field below is attacker-controllable wire data. Validate each step
  // against `byteLength` before using it to construct DataView/Uint8Array —
  // an out-of-range offset/length would otherwise throw a RangeError (or read
  // garbage) and tear down the message loop.
  const byteLength = data.byteLength;
  if (byteLength < 4) {
    throw new Error("binary frame too short to contain a buffer count");
  }
  const view = new DataView(data);
  let pos = 0;

  const bufferCount = view.getUint32(pos, true);
  pos += 4;

  const headerSize = 4 + bufferCount * 8;
  if (bufferCount < 0 || headerSize > byteLength) {
    throw new Error(
      `binary frame header overflows: bufferCount=${bufferCount}`,
    );
  }

  const offsetTable: Array<{ offset: number; length: number }> = [];
  let totalBufferSize = 0;
  for (let i = 0; i < bufferCount; i++) {
    const offset = view.getUint32(pos, true);
    pos += 4;
    const length = view.getUint32(pos, true);
    pos += 4;
    offsetTable.push({ offset, length });
    totalBufferSize += length;
  }

  const jsonEnd = byteLength - totalBufferSize;
  if (jsonEnd < headerSize || totalBufferSize > byteLength) {
    throw new Error("binary frame buffer table exceeds payload size");
  }
  const jsonBytes = new Uint8Array(data, headerSize, jsonEnd - headerSize);
  const jsonText = new TextDecoder().decode(jsonBytes);
  const json = JSON.parse(jsonText) as Record<string, unknown>;

  const bufferDataStart = jsonEnd;
  const buffers: DataView[] = [];
  for (const { offset, length } of offsetTable) {
    if (offset < 0 || length < 0 || offset + length > totalBufferSize) {
      throw new Error("binary frame buffer reference out of range");
    }
    buffers.push(new DataView(data, bufferDataStart + offset, length));
  }

  return { json, buffers };
}

/**
 * Encode a JSON-RPC response into the binary wire format.
 * Used when the response carries binary buffers (e.g. snapshot).
 */
export function encodeBinaryFrame(
  json: Record<string, unknown>,
  buffers: ArrayBuffer[],
): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const bufferCount = buffers.length;

  let totalBufferSize = 0;
  const offsets: Array<{ offset: number; length: number }> = [];
  for (const buf of buffers) {
    offsets.push({ offset: totalBufferSize, length: buf.byteLength });
    totalBufferSize += buf.byteLength;
  }

  const headerSize = 4 + bufferCount * 8;
  const totalSize = headerSize + jsonBytes.byteLength + totalBufferSize;
  const out = new ArrayBuffer(totalSize);
  const outView = new DataView(out);
  const outBytes = new Uint8Array(out);
  let pos = 0;

  outView.setUint32(pos, bufferCount, true);
  pos += 4;

  for (const { offset, length } of offsets) {
    outView.setUint32(pos, offset, true);
    pos += 4;
    outView.setUint32(pos, length, true);
    pos += 4;
  }

  outBytes.set(jsonBytes, pos);
  pos += jsonBytes.byteLength;

  for (const buf of buffers) {
    outBytes.set(new Uint8Array(buf), pos);
    pos += buf.byteLength;
  }

  return out;
}

export interface BridgeConnectResult {
  readonly session: string;
}

export class WebSocketBridge {
  private ws: WebSocket | null = null;
  private pendingWs: WebSocket | null = null;
  private router: RPCRouter;
  private cleanupBeforeUnload: (() => void) | null = null;
  private ready = false;

  constructor(readonly app: MolvisApp) {
    this.router = new RPCRouter(app);
  }

  /**
   * Dial the given `ws_url` and perform the token handshake.
   *
   * Resolves once the server has sent `{type:"ready"}`; rejects if the
   * socket closes or errors before ready arrives.
   */
  connect(
    url: string,
    token: string,
    session: string,
  ): Promise<BridgeConnectResult> {
    return new Promise<BridgeConnectResult>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      // Track the in-flight socket so disconnect() can close it before
      // ready arrives (e.g. React StrictMode unmount during dev).
      this.pendingWs = ws;

      const preReadyHandler = (event: MessageEvent) => {
        if (typeof event.data !== "string") {
          return;
        }
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
        if (msg.type === "ready") {
          ws.removeEventListener("message", preReadyHandler);
          ws.addEventListener("message", (e) => {
            void this.handleMessage(e);
          });
          this.ws = ws;
          this.pendingWs = null;
          this.ready = true;
          settle(() => resolve({ session }));
        }
      };
      ws.addEventListener("message", preReadyHandler);

      ws.addEventListener("close", (event) => {
        if (this.pendingWs === ws) this.pendingWs = null;
        if (this.ws === ws) this.ws = null;
        this.ready = false;
        this.cleanupBeforeUnload?.();
        this.cleanupBeforeUnload = null;
        settle(() =>
          reject(
            new Error(
              `WebSocket closed before ready (code ${event.code}${
                event.reason ? `, ${event.reason}` : ""
              })`,
            ),
          ),
        );
      });

      ws.addEventListener("error", () => {
        settle(() => reject(new Error(`WebSocket connection failed: ${url}`)));
      });

      ws.addEventListener("open", () => {
        const onBeforeUnload = () => {
          ws.close(1000, "tab_closed");
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        this.cleanupBeforeUnload = () => {
          window.removeEventListener("beforeunload", onBeforeUnload);
        };

        ws.send(JSON.stringify({ type: "hello", token, session }));
      });
    });
  }

  disconnect(): void {
    this.cleanupBeforeUnload?.();
    this.cleanupBeforeUnload = null;

    // Close any in-flight pre-ready socket too — otherwise React
    // StrictMode (or a re-rendered cell) can leak a dangling WebSocket
    // that races the new bridge into the server's "session already bound"
    // path, surfacing as a BrokenPipe during handshake.
    if (this.pendingWs && this.pendingWs !== this.ws) {
      try {
        this.pendingWs.close(1000, "client_disconnect");
      } catch {
        /* socket already closed */
      }
      this.pendingWs = null;
    }

    if (this.ws) {
      this.ws.close(1000, "client_disconnect");
      this.ws = null;
    }
    this.ready = false;
  }

  /**
   * Send a JSON-RPC notification (no `id`, no response expected).
   *
   * Used by `EventForwarder` to push frontend events to the controller.
   * Silently no-ops if the socket is not ready.
   */
  sendEvent(method: string, params: Record<string, unknown>): void {
    if (!this.ws || !this.ready || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      }),
    );
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    let request: Record<string, unknown>;
    let buffers: DataView[];

    try {
      if (event.data instanceof ArrayBuffer) {
        const decoded = decodeBinaryFrame(event.data);
        request = decoded.json;
        buffers = decoded.buffers;
      } else if (typeof event.data === "string") {
        request = JSON.parse(event.data) as Record<string, unknown>;
        buffers = [];
      } else {
        return;
      }
    } catch (error) {
      // Malformed frame (bad binary framing or invalid JSON). Reply with a
      // JSON-RPC parse error instead of letting the exception reject the
      // listener promise — that would silently wedge the controller and drop
      // every subsequent message on this socket.
      const message = error instanceof Error ? error.message : String(error);
      this.sendResponse({
        content: createErrorResponse(null, -32700, `Parse error: ${message}`),
      });
      return;
    }

    // Ignore non-RPC control messages (e.g. future server-initiated pings).
    if (request.type !== undefined && request.jsonrpc === undefined) {
      return;
    }

    const response: RPCResponseEnvelope = await this.router.execute(
      request,
      buffers,
    );

    this.sendResponse(response);
  }

  private sendResponse(response: RPCResponseEnvelope): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      if (response.buffers && response.buffers.length > 0) {
        const frame = encodeBinaryFrame(
          response.content as unknown as Record<string, unknown>,
          response.buffers,
        );
        this.ws.send(frame);
      } else {
        this.ws.send(JSON.stringify(response.content));
      }
    } catch (error) {
      // A result that cannot be encoded (circular structure, BigInt, detached
      // buffer) must still produce a reply. Without this the exception escapes
      // the async message listener as an unhandled rejection, no frame is ever
      // sent, and the caller can only observe a timeout — which says nothing
      // about what actually went wrong. Mirrors the inbound parse-error guard.
      const message = error instanceof Error ? error.message : String(error);
      const id = (response.content as { id?: number | null }).id ?? null;
      try {
        this.ws.send(
          JSON.stringify(
            createErrorResponse(
              id,
              -32603,
              `Response serialization failed: ${message}`,
            ),
          ),
        );
      } catch {
        // The socket itself is unusable; the peer's timeout is all that's left.
      }
    }
  }
}
