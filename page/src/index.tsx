import "./public-path";
import {
  type MountedApp,
  type MountHostOpts,
  mountMolvisApp,
} from "@/lib/mount";
import { readMountOptsFromHost, readMountOptsFromUrl } from "@/lib/mount-opts";
import "@/styles/tailwind.css";
import { bootstrapTheme } from "./hooks/useTheme";

declare global {
  interface Window {
    /**
     * Programmatic mount entry exposed for inline-embedded hosts (Jupyter
     * notebook, marimo, etc.). The Python `_repr_mimebundle_` writes a
     * `<script>` that calls `window.MolvisApp.mount(el, opts)` after
     * loading this bundle.
     */
    MolvisApp?: {
      mount(host: HTMLElement, opts?: MountHostOpts): MountedApp;
    };
  }
}

if (typeof window !== "undefined") {
  window.MolvisApp = { mount: mountMolvisApp };
}

// Standalone bootstrap: when an HTML host page exposes `<div id="root">`
// (i.e. our own `index.html`), mount automatically using URL params.
if (typeof document !== "undefined") {
  const rootEl = document.getElementById("root");
  if (rootEl) {
    bootstrapTheme();
    mountMolvisApp(rootEl, {
      ...readMountOptsFromUrl(),
      ...readMountOptsFromHost(),
      useShadowDOM: false,
    });
  }
}
