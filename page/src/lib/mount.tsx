import type { Molvis } from "@molcrafts/molvis-stage";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "@/App";
import { PipelineOperationProvider } from "@/components/viewer/PipelineOperationProvider";
import { registerThemeRoot, unregisterThemeRoot } from "@/hooks/useTheme";
import { MountOptsRoot } from "@/lib/MountOptsRoot";
import type { MolvisSurface, MountOpts } from "@/lib/mount-opts";
import { MountOptsStore } from "@/lib/mount-opts-store";
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
  /**
   * Called with the engine each time the viewer mounts one, and with `null`
   * when it is torn down. Hosts that talk to the engine directly use it —
   * the VS Code webview attaches its file/settings/save bridge here.
   */
  onAppChange?: (app: Molvis | null) => void;
  /**
   * Called when the user asks for a different surface from inside the canvas.
   *
   * Supplying this takes ownership of the surface bit: the host **must**
   * complete the round trip by calling {@link MountedApp.setOpts} with the new
   * surface, or the affordance does nothing. Omit it and the mount keeps the
   * bit itself, applying the change directly.
   */
  onSurfaceChange?: (surface: MolvisSurface) => void;
  /**
   * Offered the workspace URIs of a drag before the shell reads
   * `dataTransfer`. A webview cannot read a workspace file, so a drag from the
   * host's file explorer arrives as `text/uri-list` with no `File` behind it
   * and only the host can load it. Return `true` to claim the drop; the shell
   * then skips its own path so one drag is never loaded twice.
   */
  onDropUris?: (uris: string[]) => boolean;
}

/** Result of {@link mountMolvisApp}, allowing the host to tear down. */
export interface MountedApp {
  dispose(): void;
  /**
   * Change the mount options of the running app — the host's half of the
   * surface round trip. A no-op after {@link MountedApp.dispose}.
   */
  setOpts(next: Partial<MountOpts>): void;
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

  // The options are state from here on, not the caller's literal: a host can
  // patch them through `setOpts` and the tree re-renders. Composing the
  // fallback here — rather than inside `MountOptsRoot` — keeps the question of
  // who owns the surface in exactly one place.
  const store = new MountOptsStore(opts);
  const onSurfaceChange =
    opts.onSurfaceChange ??
    ((surface: MolvisSurface) => store.patch({ surface }));

  const root: Root = createRoot(mountTarget);
  root.render(
    <React.StrictMode>
      <MountOptsRoot store={store}>
        <PortalContainerProvider value={portalContainer}>
          <PipelineOperationProvider>
            <App
              onAppChange={opts.onAppChange}
              onSurfaceChange={onSurfaceChange}
              onDropUris={opts.onDropUris}
            />
          </PipelineOperationProvider>
        </PortalContainerProvider>
      </MountOptsRoot>
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
      // Unmount first: closing the store before teardown would let a
      // subscriber read a closed store mid-unmount.
      store.close();
      if (useShadow && host.shadowRoot) {
        host.shadowRoot.replaceChildren();
      }
    },
    setOpts(next: Partial<MountOpts>) {
      store.patch(next);
    },
  };
  mountedApps.set(host, mounted);
  return mounted;
}
