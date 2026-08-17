/**
 * Sketch surface — Activity Bar view and Sketch Quick View share this entry.
 *
 * Does **not** import `page/` (page depends on sketch; hosts never reverse that).
 * Chrome is package-owned via `SketchComposer({ gui: true })`.
 * Quick View host messages: init / loadFile / triggerSave (see attachSketchQuickViewHost).
 */

import { SketchComposer } from "@molcrafts/molvis-sketch";
import type { WebviewToHostMessage } from "../protocol";
import {
  attachSketchQuickViewHost,
  postSketchQuickViewReady,
} from "../webview/attachSketchQuickViewHost";

declare const acquireVsCodeApi: () => {
  postMessage: (message: WebviewToHostMessage) => void;
};

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
    );
  }
  return btoa(chunks.join(""));
}

const host = acquireVsCodeApi();

const root = document.getElementById("root");
if (!root) {
  throw new Error("MolVis Sketch root is missing");
}

// Dark-ish token overrides for VS Code webview (sketch defaults are light).
root.className = "molvis-sketch-vscode-host";
root.style.cssText = [
  "position:absolute",
  "inset:0",
  "margin:0",
  "display:block",
  "--msk-rail-bg:#252526",
  "--msk-stage-bg:#1e1e1e",
  "--msk-ink:#cccccc",
  "--msk-muted:#858585",
  "--msk-hover:rgba(255,255,255,0.06)",
  "--msk-active:rgba(14,99,156,0.45)",
  "--msk-active-ink:#4fc1ff",
  "--msk-active-fg:#ffffff",
  "--msk-sep:#3c3c3c",
  "--msk-font:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
].join(";");

const composer = new SketchComposer({
  gui: true,
  onExportFile: async (blob, suggestedName) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    host.postMessage({
      type: "saveFile",
      data: bytesToBase64(bytes),
      suggestedName,
    });
  },
});

composer.mount(root);

const bridge = attachSketchQuickViewHost(composer, { host });
postSketchQuickViewReady(host);

window.addEventListener("beforeunload", () => {
  bridge.dispose();
  composer.unmount();
});
