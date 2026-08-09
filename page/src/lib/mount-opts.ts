import { createContext, useContext } from "react";

/**
 * Named surface presets for the page chrome layout.
 *
 * - `"full"` — all chrome visible (default).
 * - `"canvas"` — no chrome; 3D canvas only (embeds / `gui=False`).
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
  /** Left sidebar (compute, pair distribution, pipeline). */
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
   * Canvas clear colour as `#RRGGBB` or `#RRGGBBAA`. Omit to keep whatever
   * Babylon renders by default. Applied once the engine reports ready.
   */
  background?: string;
  /**
   * Opt-in demo seed. `true` seeds a Dopamine molecule on start; `false`
   * or undefined leaves the canvas empty. Defaults on in dev mode so
   * `npm run dev:page` stays interactive; production embeds (VSCode,
   * Python, third-party mounts) never see the demo unless they pass
   * this flag explicitly (or the URL carries `?demo=1`).
   */
  demo?: boolean;
  /**
   * Plugin sources to load on mount. Prefer short GitHub form
   * `owner/repo` or `owner/repo@tag` (host resolves Release assets).
   * HTTPS only for local debug serve. Merged with Settings / localStorage.
   * VSCode: `molvis.plugins`. Python: `Molvis(plugins=[…])` / URL `plugins=`.
   */
  plugins?: string[];
}

const MountOptsContext = createContext<MountOpts>({});

export const MountOptsProvider = MountOptsContext.Provider;

export function useMountOpts(): MountOpts {
  return useContext(MountOptsContext);
}

/**
 * Resolve the effective chrome flags from a {@link MountOpts} value.
 *
 * Precedence (highest wins): `chrome` overrides → `surface` preset.
 * When nothing is specified the default is `surface: "full"` (all flags true).
 */
export function resolveChrome(opts: MountOpts): Required<MolvisChromeFlags> {
  const surface = opts.surface ?? "full";

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
function parsePluginsField(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const list = value
      .filter((v): v is string => typeof v === "string")
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    // Comma-separated for URL: plugins=a/b@v1,c/d@v2
    const list = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
  return undefined;
}

export function readMountOptsFromHost(): Partial<MountOpts> {
  if (typeof window === "undefined") return {};

  const init = (
    window as Window &
      typeof globalThis & {
        __MOLVIS_VSCODE_INIT__?: {
          mount?: Partial<MountOpts>;
          /** Flat plugins list some hosts put next to mount. */
          plugins?: unknown;
        };
      }
  ).__MOLVIS_VSCODE_INIT__;

  if (!init) return {};

  const mount = init.mount ? { ...init.mount } : {};
  const fromMount = parsePluginsField(mount.plugins);
  const fromRoot = parsePluginsField(init.plugins);
  if (fromMount || fromRoot) {
    mount.plugins = fromMount ?? fromRoot;
  }
  return mount;
}

/** Build {@link MountOpts} from the current `window.location.search`. */
export function readMountOptsFromUrl(): MountOpts {
  const params = new URLSearchParams(window.location.search);
  const surfaceRaw = params.get("surface");
  const surface: MolvisSurface | undefined =
    surfaceRaw === "full" || surfaceRaw === "canvas" ? surfaceRaw : undefined;
  return {
    wsUrl: params.get("ws_url") ?? undefined,
    token: params.get("token") ?? undefined,
    session: params.get("session") ?? undefined,
    surface,
    background: params.get("background") ?? undefined,
    demo: params.has("demo") ? true : undefined,
    plugins: parsePluginsField(params.get("plugins") ?? undefined),
  };
}
