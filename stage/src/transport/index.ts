/**
 * Transport subsystem: connects a local `MolvisApp` to a remote
 * controller (Python or any other language) over a WebSocket. See
 * `ws_bridge.ts` for the wire-level handshake and
 * `rpc/router.ts` for the JSON-RPC dispatch table.
 */

import type { MolvisApp } from "../app";
import { Session } from "../pipeline/session";
import { EventForwarder } from "./event_forwarder";
import { WebSocketBridge } from "./ws_bridge";

export { EventForwarder } from "./event_forwarder";
export {
  isRpcMethodName,
  listRpcMethods,
  RPC_METHODS,
  RPC_PROTOCOL_VERSION,
  type RpcMethodName,
} from "./rpc/catalog";
export {
  BinaryResult,
  listRpcExtensionHandlers,
  RPCRouter,
  registerRpcExtensionHandler,
} from "./rpc/router";
// The molecular payload codec, re-exported so page plugins registering their
// own RPC methods decode Frames the same way the built-in handlers do instead
// of hand-rolling it. Shapes live in `@molcrafts/molvis-core/wire`.
export {
  decodeBox,
  decodeFrame,
  encodeFrame,
  FramePayloadError,
} from "./rpc/serialization";
export type {
  JsonRPCRequest,
  JsonRPCResponse,
  RPCResponseEnvelope,
} from "./rpc/types";
export { applyBackendState } from "./state_sync";
export { type BridgeConnectResult, WebSocketBridge } from "./ws_bridge";

export interface AttachWebSocketBridgeOpts {
  /** WebSocket URL served by the Python-side transport. */
  wsUrl: string;
  /** Token embedded in the page URL; validated during handshake. */
  token?: string;
  /** Logical session id sent with the hello frame. Defaults to "default". */
  session?: string;
  /**
   * Called if the handshake fails. Defaults to `console.error`; supply
   * this to plug into a host-specific error channel (VSCode status bar,
   * notebook cell output, …) instead.
   */
  onError?: (err: unknown) => void;
  /**
   * Called after the hello handshake completes successfully and the
   * event forwarder has been started. Use this to flip UI state from
   * "connecting" to "connected".
   */
  onConnected?: () => void;
}

/**
 * Attach a WebSocket bridge to the given app. Connects, starts forwarding
 * core events once `ready` is received, and returns a disposer that
 * stops the forwarder and closes the socket (safe to call from a React
 * effect cleanup, `beforeunload`, etc.).
 *
 * The returned disposer is idempotent and safe to call before the
 * handshake completes — in-flight sockets are cancelled.
 */
export function attachWebSocketBridge(
  app: MolvisApp,
  opts: AttachWebSocketBridgeOpts,
): () => void {
  const bridge = new WebSocketBridge(app);
  const forwarder = new EventForwarder(bridge, app);
  let cancelled = false;

  bridge
    .connect(opts.wsUrl, opts.token ?? "", opts.session ?? "default")
    .then(() => {
      if (cancelled) {
        bridge.disconnect();
        return;
      }
      forwarder.start();
      // The connection becomes a visible, operable row. Everything the
      // operator can act on lives in one list; a live resource does not
      // belong in a settings dialog.
      app.modifierPipeline.setSession(
        new Session("session", opts.wsUrl, () => {
          forwarder.stop();
          bridge.disconnect();
        }),
      );
      opts.onConnected?.();
      // Ask the controller for whatever it last pushed — the reply
      // arrives as a ``scene.apply_state`` RPC which the router turns
      // into a ``backend-state-sync`` event on the app bus.
      bridge.sendEvent("event.request_state_sync", {});
    })
    .catch((err) => {
      if (opts.onError) {
        opts.onError(err);
      } else {
        console.error("Failed to connect WebSocket bridge:", err);
      }
    });

  return () => {
    cancelled = true;
    // Removing the row disconnects, so route the teardown through it and let
    // the two paths converge instead of each closing the socket its own way.
    const session = app.modifierPipeline.session();
    if (session) {
      app.modifierPipeline.removeEntry(session.id);
      return;
    }
    forwarder.stop();
    bridge.disconnect();
  };
}
