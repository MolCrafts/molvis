/**
 * Quick look bootstrap — stage only, deferred by `webview/index.ts`.
 *
 * Host messaging lives in {@link attachQuickViewHost}; this file only
 * mounts the engine and starts it.
 */

import { mountMolvis } from "@molcrafts/molvis-stage";
import type { WebviewToHostMessage } from "../protocol";
import { attachQuickViewHost, postQuickViewReady } from "./attachQuickViewHost";
import {
  createCapabilityRegistry,
  DEFAULT_STAGE_CAPABILITIES,
} from "./capabilities";
import { installGlobalErrorHandlers, reportError } from "./errorBoundary";

declare const acquireVsCodeApi: () => {
  postMessage: (message: WebviewToHostMessage) => void;
};

export interface BootstrapOptions {
  /**
   * Called once Babylon is up and the first render loop is running. The host
   * dismisses the boot mask here. That mask is not shown again.
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
    { showUI: true, ui: { showStatusPanel: true } },
    {
      grid: { enabled: true },
    },
  );

  const bridge = attachQuickViewHost(app, { host });
  const capabilities = createCapabilityRegistry({ app, host });

  window.addEventListener("beforeunload", () => {
    capabilities.dispose();
    bridge.dispose();
    app.destroy();
  });

  // App startup is independent from molecule shader compilation.
  // Post `ready` before outline/settings so the host can `openUri` (and
  // the trajectory HUD can appear) without waiting on those imports.
  void app
    .start()
    .then(async () => {
      options.onReady?.();
      postQuickViewReady(host);
      for (const id of DEFAULT_STAGE_CAPABILITIES) {
        await capabilities.enable(id);
      }
    })
    .catch((error: unknown) => {
      // Dismiss overlay so the canvas (and any error toast) is visible.
      options.onReady?.();
      reportError(host, "Failed to start MolVis", error);
    });
}
