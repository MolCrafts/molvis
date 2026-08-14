/**
 * Host bridge for Sketch Quick View (2D peek).
 *
 * Parallel to {@link attachQuickViewHost} for stage — no `page/` imports.
 * Handles init / loadFile / triggerSave over the shared protocol subset.
 */

import type { SketchComposer } from "@molcrafts/molvis-sketch";
import type { HostToWebviewMessage, WebviewToHostMessage } from "../protocol";
import { tryParseMolV2000 } from "./mol_v2000";

export type SketchHost = {
  postMessage: (message: WebviewToHostMessage) => void;
};

export type SketchQuickViewHostHandle = {
  dispose: () => void;
};

/** Host → sketch messages that Quick View understands. */
export const SKETCH_QUICK_VIEW_HOST_MESSAGE_TYPES = [
  "init",
  "applySettings",
  "loadFile",
  "triggerSave",
  "error",
] as const;

export { tryParseMolV2000 } from "./mol_v2000";

function payloadToText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) {
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(content);
    } catch {
      return null;
    }
  }
  return null;
}

export function attachSketchQuickViewHost(
  composer: SketchComposer,
  _options: { host: SketchHost },
): SketchQuickViewHostHandle {
  const onMessage = (event: MessageEvent): void => {
    const msg = event.data as HostToWebviewMessage | undefined;
    if (!msg || typeof msg !== "object" || !("type" in msg)) return;

    switch (msg.type) {
      case "init":
      case "applySettings":
        // Sketch QV has no settings surface yet — accept for handshake.
        break;
      case "loadFile": {
        const text = payloadToText(msg.content);
        if (!text) break;
        const data = tryParseMolV2000(text);
        if (data) {
          composer.board.loadMoleculeData(data);
        }
        // Unsupported formats: keep empty board; never throw.
        break;
      }
      case "triggerSave":
        // Sketch export is UI-driven (SVG/PNG menu); host Save is a no-op here.
        break;
      case "error":
        break;
      default:
        break;
    }
  };

  window.addEventListener("message", onMessage);

  return {
    dispose() {
      window.removeEventListener("message", onMessage);
    },
  };
}

export function postSketchQuickViewReady(host: SketchHost): void {
  host.postMessage({ type: "ready" });
}
