/**
 * Quick View bootstrap — stage only, deferred by `webview/index.ts`.
 *
 * Host messaging lives in {@link attachQuickViewHost}; this file only
 * mounts the engine and starts it.
 */

import { mountMolvis } from "@molcrafts/molvis-stage";
import type { WebviewToHostMessage } from "../protocol";
import { attachQuickViewHost, postQuickViewReady } from "./attachQuickViewHost";
import { installGlobalErrorHandlers, reportError } from "./errorBoundary";

declare const acquireVsCodeApi: () => {
  postMessage: (message: WebviewToHostMessage) => void;
};

export interface BootstrapOptions {
  /**
   * Called once the MolVis app has finished starting (engine up, first render
   * loop running). The host uses it to dismiss the loading overlay.
   */
  onReady?: () => void;
}

export function bootstrapWebview(
  container: HTMLElement,
  options: BootstrapOptions = {},
): void {
  const host = acquireVsCodeApi();
  installGlobalErrorHandlers(host);

  const app = mountMolvis(
    container,
    { showUI: true },
    {
      grid: { enabled: true },
    },
  );

  const bridge = attachQuickViewHost(app, { host });

  window.addEventListener("beforeunload", () => {
    bridge.dispose();
    app.destroy();
  });

  // App startup is independent from molecule shader compilation.
  void app
    .start()
    .then(() => {
      options.onReady?.();
      postQuickViewReady(host);
    })
    .catch((error: unknown) => {
      // Dismiss overlay so the canvas (and any error toast) is visible.
      options.onReady?.();
      reportError(host, "Failed to start MolVis", error);
    });
}
