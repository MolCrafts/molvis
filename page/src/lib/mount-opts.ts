import { createContext, useContext } from "react";

/**
 * Named surface presets for the page chrome layout.
 *
 * - `"full"` — all chrome visible (default).
 * - `"canvas"` — no chrome; 3D canvas only (identical to the legacy
 *   `minimal: true` flag).
 */
export type MolvisSurface = "full" | "canvas";

/**
 * Per-panel visibility flags applied on top of the {@link MolvisSurface}
 * preset. Every flag defaults to the surface's default; set only the
 * panels you want to override.
 */
export interface MolvisChromeFlags {
  /** Top bar (mode selector, fullscreen toggle, settings). */
  topBar?: boolean;
  /** Left sidebar (analysis, RDF, pipeline). */
  leftSidebar?: boolean;
  /** Right sidebar (mode-specific panels). */
  rightSidebar?: boolean;
  /** Bottom status bar. */
  statusBar?: boolean;
  /** Timeline control (only shown when trajectory length > 1). */
  timeline?: boolean;
}

/**
 * Configuration passed to {@link mountMolvisApp} when bootstrapping the
 * page. Standalone mode reads these from URL params; the notebook host
 * passes them inline via `window.MolvisApp.mount(el, opts)`.
 */
export interface MountOpts {
  /** WebSocket URL of the controller (e.g. `ws://localhost:54321/ws`). */
  wsUrl?: string;
  /** Pre-shared token used in the hello frame. */
  token?: string;
  /** Session label sent with hello and used in event routing. */
  session?: string;
  /**
   * Named surface preset. `"canvas"` hides all chrome; `"full"` (default)
   * shows everything. Override individual panels with {@link chrome}.
   */
  surface?: MolvisSurface;
  /**
   * Per-panel visibility overrides. Applied on top of the surface preset;
   * only the keys you set are overridden.
   */
  chrome?: MolvisChromeFlags;
  /**
   * When `true`, hide all chrome and render only the canvas.
   * @deprecated Use `surface: "canvas"` instead; this alias is honored for
   * backward compatibility.
   */
  minimal?: boolean;
  /**
   * Opt-in demo seed. `true` seeds a Dopamine molecule on start; `false`
   * or undefined leaves the canvas empty. Defaults on in dev mode so
   * `npm run dev:page` stays interactive; production embeds (VSCode,
   * Python, third-party mounts) never see the demo unless they pass
   * this flag explicitly (or the URL carries `?demo=1`).
   */
  demo?: boolean;
}

const MountOptsContext = createContext<MountOpts>({});

export const MountOptsProvider = MountOptsContext.Provider;

export function useMountOpts(): MountOpts {
  return useContext(MountOptsContext);
}

/**
 * Resolve the effective chrome flags from a {@link MountOpts} value.
 *
 * Precedence (highest wins): `chrome` overrides → `surface` preset →
 * legacy `minimal` alias. When nothing is specified the default is
 * `surface: "full"` (all flags `true`).
 */
export function resolveChrome(opts: MountOpts): Required<MolvisChromeFlags> {
  const surface = opts.surface ?? (opts.minimal ? "canvas" : "full");

  const defaults: Required<MolvisChromeFlags> =
    surface === "canvas"
      ? {
          topBar: false,
          leftSidebar: false,
          rightSidebar: false,
          statusBar: false,
          timeline: false,
        }
      : {
          topBar: true,
          leftSidebar: true,
          rightSidebar: true,
          statusBar: true,
          timeline: true,
        };

  return {
    topBar: opts.chrome?.topBar ?? defaults.topBar,
    leftSidebar: opts.chrome?.leftSidebar ?? defaults.leftSidebar,
    rightSidebar: opts.chrome?.rightSidebar ?? defaults.rightSidebar,
    statusBar: opts.chrome?.statusBar ?? defaults.statusBar,
    timeline: opts.chrome?.timeline ?? defaults.timeline,
  };
}

/**
 * Read mount options injected by the VSCode extension host via
 * `window.__MOLVIS_VSCODE_INIT__`. Returns an empty object when the
 * global is absent (e.g. standalone or notebook hosts) so the result
 * is always safe to spread.
 */
export function readMountOptsFromHost(): Partial<MountOpts> {
  if (typeof window === "undefined") return {};

  const init = (
    window as Window &
      typeof globalThis & {
        __MOLVIS_VSCODE_INIT__?: { mount?: Partial<MountOpts> };
      }
  ).__MOLVIS_VSCODE_INIT__;

  if (!init?.mount) return {};
  return init.mount;
}

/** Build {@link MountOpts} from the current `window.location.search`. */
export function readMountOptsFromUrl(): MountOpts {
  const params = new URLSearchParams(window.location.search);
  return {
    wsUrl: params.get("ws_url") ?? undefined,
    token: params.get("token") ?? undefined,
    session: params.get("session") ?? undefined,
    minimal: params.has("minimal"),
    demo: params.has("demo") ? true : undefined,
  };
}
