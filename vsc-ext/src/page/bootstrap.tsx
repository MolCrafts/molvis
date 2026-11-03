/**
 * Page bootstrap — everything heavy (React shell, engine, wasm) lives behind
 * this module so `page/index.tsx` can paint the loading overlay first. Mirrors
 * `webview/index.ts` → `webview/controller.ts` for Quick look.
 *
 * The page owns its own engine, so the host bridge cannot be attached at
 * mount time — `onAppChange` hands it over once the engine is up, and again
 * with `null` when the page reloads the viewer.
 */

import { bootstrapTheme } from "@/hooks/useTheme";
import { mountMolvisApp } from "@/lib/mount";
import { readMountOptsFromHost } from "@/lib/mount-opts";
import type { WebviewToHostMessage } from "../protocol";
import { attachPageHost, postPageReady } from "../webview/attachPageHost";
import type { StageHostHandle } from "../webview/attachStageHost";
import {
  type CapabilityRegistry,
  createCapabilityRegistry,
  DEFAULT_STAGE_CAPABILITIES,
} from "../webview/capabilities";
import { installGlobalErrorHandlers } from "../webview/errorBoundary";
import "./main.css";

declare const acquireVsCodeApi: () => {
  postMessage: (message: WebviewToHostMessage) => void;
};

export interface BootstrapPageOptions {
  /** Called once the React shell is mounted — the host drops its overlay. */
  onReady?: () => void;
  /** Load phase while a host-driven load runs; `null` when it settles. */
  onBusy?: (label: string | null) => void;
}

export function bootstrapPage(
  container: HTMLElement,
  options: BootstrapPageOptions = {},
): void {
  bootstrapTheme();
  document.documentElement.classList.add("dark");

  const host = acquireVsCodeApi();
  installGlobalErrorHandlers(host);

  let bridge: StageHostHandle | null = null;
  let capabilities: CapabilityRegistry | null = null;

  // The surface has to be known at first paint. `init.surface` cannot be:
  // it arrives only after the shell mounts and posts `ready`, so a panel that
  // wants chrome off would paint full chrome and then collapse. The host
  // injects it into the document instead; `init.surface` confirms it later.
  const boot = readMountOptsFromHost();

  const mounted = mountMolvisApp(container, {
    surface: boot.surface ?? "full",
    useShadowDOM: false,
    // A drag from the Explorer carries workspace URIs and no `File`; only the
    // host can read those, so it claims the drop. Without this, migrating a
    // panel to this bundle silently loses Explorer drag-and-drop.
    onDropUris: (uris) => {
      const uri = uris[0];
      if (!uri) return false;
      host.postMessage({ type: "dropUri", uri, mode: "replace" });
      return true;
    },
    // Intent, not state: the host owns the surface bit and answers with
    // `setSurface`, which `onSurface` below applies. Supplying this callback is
    // what hands ownership over — link 01's local fallback stops applying here,
    // so the tab title and a replayed `init` stay in step with what is shown.
    onSurfaceChange: (surface) => {
      host.postMessage({ type: "surfaceChanged", surface });
    },
    onAppChange: (app) => {
      bridge?.dispose();
      bridge = null;
      // The registry captures one app and subscribes to its events, and the
      // page replaces the app on reload — so its lifetime is the app's, not
      // the document's.
      capabilities?.dispose();
      capabilities = null;
      if (!app) return;
      // Drop handling stays with the page shell (it owns the drop UI and the
      // unsaved-scene prompt), so the bridge contributes load/settings/save
      // only.
      bridge = attachPageHost(app, {
        host,
        enableDrop: false,
        onBusy: options.onBusy,
        // The host owns the surface bit; the shell just applies it.
        onSurface: (surface) => mounted.setOpts({ surface }),
      });
      capabilities = createCapabilityRegistry({ app, host });
      options.onReady?.();
      // `onAppChange` fires after `app.start()`, so the host may load
      // immediately.
      postPageReady(host);
      void (async () => {
        for (const id of DEFAULT_STAGE_CAPABILITIES) {
          await capabilities?.enable(id);
        }
      })();
    },
  });
}
