import React from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "@/App";
import { PipelineOperationProvider } from "@/components/viewer/PipelineOperationProvider";
import { registerThemeRoot, unregisterThemeRoot } from "@/hooks/useTheme";
import { type MountOpts, MountOptsProvider } from "@/lib/mount-opts";
import { PortalContainerProvider } from "@/lib/portal-container";

/** Extra options for the host integration (not consumed by React tree). */
export interface MountHostOpts extends MountOpts {
  /**
   * When `true` (default for cell embeds), mount inside a Shadow DOM
   * root so the page bundle's Tailwind preflight can not leak into the
   * host document. The host element's class is mirrored to the shadow
   * host so theme classes (`dark`) keep working.
   */
  useShadowDOM?: boolean;
  /**
   * URLs of CSS files to inject into the shadow root. Required when
   * `useShadowDOM` is true; ignored otherwise.
   */
  cssUrls?: string[];
  /**
   * Initial theme for the embedded mount (`light` | `dark`). Only used
   * when `useShadowDOM` is true; standalone mode reads from
   * `localStorage` via {@link bootstrapTheme}.
   */
  theme?: "light" | "dark";
}

/** Result of {@link mountMolvisApp}, allowing the host to tear down. */
export interface MountedApp {
  dispose(): void;
}

// Notebook embeds rarely call `dispose()`. We track mounts on a WeakMap
// keyed by host element and watch document mutations: when a host (or one
// of its ancestors — VSCode replaces the cell output wrapper, not the
// host directly) is detached from the document, we tear down its Babylon
// engine. Without this, every cell re-execution leaks a WebGL context +
// 60 fps render loop.
const HOST_ATTR = "data-molvis-mount";
const mountedApps = new WeakMap<HTMLElement, MountedApp>();
let removalObserver: MutationObserver | null = null;

function disposeIfTracked(host: HTMLElement): void {
  const mounted = mountedApps.get(host);
  if (!mounted) return;
  mountedApps.delete(host);
  mounted.dispose();
}

function disposeRemovedSubtree(node: Node): void {
  if (!(node instanceof HTMLElement)) return;
  disposeIfTracked(node);
  if (typeof node.querySelectorAll === "function") {
    node
      .querySelectorAll<HTMLElement>(`[${HOST_ATTR}]`)
      .forEach(disposeIfTracked);
  }
}

function ensureRemovalObserver(): void {
  if (removalObserver) return;
  if (typeof document === "undefined" || !document.body) return;
  removalObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.removedNodes.forEach(disposeRemovedSubtree);
    }
  });
  removalObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Mount the full MolVis page application into `host`. The standalone
 * entry uses this with `useShadowDOM=false` against `<div id="root">`;
 * the notebook host calls it with `useShadowDOM=true` so each cell is
 * style-isolated from the surrounding notebook.
 *
 * Mounting twice on the same host disposes the previous mount first.
 * Detaching the host from the document (via parent removal) auto-disposes
 * via a MutationObserver.
 */
export function mountMolvisApp(
  host: HTMLElement,
  opts: MountHostOpts = {},
): MountedApp {
  disposeIfTracked(host);

  const useShadow = opts.useShadowDOM ?? false;

  let mountTarget: HTMLElement;
  let portalContainer: HTMLElement | null = null;
  if (useShadow) {
    const shadow = host.attachShadow({ mode: "open" });
    if (!host.style.width) host.style.width = "100%";
    if (!host.style.height) host.style.height = "100%";
    if (!host.style.display) host.style.display = "block";
    // Percentage heights inside a shadow root don't reliably resolve
    // against the host, so the wrapper below anchors with `inset:0`
    // and needs the host to be a positioned containing block.
    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }

    // Shadow-scoped CSS inherits tokens from the host, not documentElement.
    // Register so Settings → Appearance light/dark toggles the host class.
    // opts.theme seeds only when the user has no stored preference yet.
    registerThemeRoot(
      host,
      opts.theme === "light" || opts.theme === "dark" ? opts.theme : undefined,
    );

    for (const url of opts.cssUrls ?? []) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      shadow.appendChild(link);
    }

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "position:absolute;inset:0;overflow:hidden;";
    shadow.appendChild(wrapper);
    mountTarget = wrapper;

    // Radix portals must land inside the shadow root or they lose every
    // style — see `portal-container.tsx`. A sibling of the wrapper rather
    // than a child of it: the wrapper clips (`overflow:hidden`) and React
    // owns its subtree, and portal content is `position: fixed` against the
    // viewport regardless of where in the shadow tree it sits.
    portalContainer = document.createElement("div");
    portalContainer.setAttribute("data-molvis-portals", "");
    shadow.appendChild(portalContainer);
  } else {
    mountTarget = host;
  }

  const root: Root = createRoot(mountTarget);
  root.render(
    <React.StrictMode>
      <MountOptsProvider value={opts}>
        <PortalContainerProvider value={portalContainer}>
          <PipelineOperationProvider>
            <App />
          </PipelineOperationProvider>
        </PortalContainerProvider>
      </MountOptsProvider>
    </React.StrictMode>,
  );

  host.setAttribute(HOST_ATTR, "");
  ensureRemovalObserver();

  const mounted: MountedApp = {
    dispose() {
      mountedApps.delete(host);
      host.removeAttribute(HOST_ATTR);
      if (useShadow) {
        unregisterThemeRoot(host);
      }
      root.unmount();
      if (useShadow && host.shadowRoot) {
        host.shadowRoot.replaceChildren();
      }
    },
  };
  mountedApps.set(host, mounted);
  return mounted;
}
