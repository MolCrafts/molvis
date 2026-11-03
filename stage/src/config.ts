/**
 * Molvis configuration - simplified
 */

import type { Engine } from "@babylonjs/core";
import type { MolvisApp } from "./app";
import type { ModeType } from "./mode/mode_type";
import type { MenuItem, SceneHit } from "./mode/types";

// Canvas settings
export interface CanvasConfig {
  antialias?: boolean;
  alpha?: boolean;
  preserveDrawingBuffer?: boolean;
  stencil?: boolean;
}

// UI components configuration
export interface UIConfig {
  showInfoPanel?: boolean;
  showModePanel?: boolean;
  showViewPanel?: boolean;
  showPerfPanel?: boolean;
  showTrajPanel?: boolean;
  showContextMenu?: boolean;
  contextMenu?: ContextMenuConfig;
}

export interface ContextMenuBuildContext {
  app: MolvisApp;
  menuId: string;
  hit: SceneHit | null;
  items: readonly MenuItem[];
}

export interface ContextMenuConfig {
  buildItems?: (context: ContextMenuBuildContext) => MenuItem[];
}

/**
 * Molvis configuration
 */
export interface MolvisConfig {
  // UI Display
  showUI?: boolean;
  useRightHandedSystem?: boolean;
  ui?: UIConfig;

  /**
   * Interaction modes available through both keyboard shortcuts and
   * {@link MolvisApp.setMode}. Ordinary MolVis mounts enable every mode; small
   * embeds can opt into a narrower set. View is always retained as the safe
   * fallback mode.
   */
  enabledModes?: readonly ModeType[];

  // Canvas settings
  canvas?: CanvasConfig;

  /**
   * When `false`, construct a GUI-less ("semi-headless") app: skip the DOM
   * chrome, web components, sidebar GUI, and interaction modes, building only
   * the render core (engine, scene, pipeline, artist). Used by
   * {@link "../renderer".MolvisRenderer} so other frontends can drive
   * snapshots/animations without mounting the full UI. Default `true`.
   */
  gui?: boolean;

  /**
   * Advanced / headless / testing: inject a pre-built BabylonJS engine
   * (e.g. `NullEngine` in tests, or a `WebGPUEngine`) instead of letting the
   * app create a `new Engine(canvas)`. Only consulted on the `gui: false`
   * construction path. Not serializable — set programmatically only.
   */
  engine?: Engine;

  /**
   * Controls who disposes an injected {@link engine}. The default, `"app"`,
   * preserves the historical one-app/one-engine lifecycle. Use `"external"`
   * when several GUI-less apps share one BabylonJS engine.
   */
  engineOwnership?: "app" | "external";

  /**
   * Attach Babylon camera pointer/wheel controls to the canvas. Disable this
   * for read-only previews. Default `true`.
   */
  interactive?: boolean;

  /**
   * Render viewport decorations such as the corner axis helper. Disable this
   * for compact read-only previews. Default `true`.
   */
  decorations?: boolean;
}

export type ResolvedMolvisConfig = Required<Omit<MolvisConfig, "engine">> & {
  ui: Required<Omit<UIConfig, "contextMenu">> & {
    contextMenu?: ContextMenuConfig;
  };
  canvas: Required<CanvasConfig>;
};

/**
 * Build default config from pure literals inside a function body.
 *
 * Critical for the VS Code webview dual-runtime split: rspack rewrites some
 * module-level `const` exports to `chunkId === owner ? value : null` when the
 * same module is evaluated under two webpack runtimes (vendor `runtime.js` vs
 * wasm `96612.js`). Closures that read those exports at call time then throw
 * ("X is not iterable", "Cannot convert null to object"). Function bodies that
 * only construct local literals are immune.
 */
function buildDefaultConfig(): ResolvedMolvisConfig {
  return {
    showUI: true,
    useRightHandedSystem: true,
    gui: true,
    engineOwnership: "app",
    interactive: true,
    decorations: true,
    enabledModes: [
      "view",
      "select",
      "edit",
      "measure",
      "manipulate",
    ] as ModeType[],
    ui: {
      showModePanel: true,
      showViewPanel: true,
      showInfoPanel: true,
      showPerfPanel: true,
      showTrajPanel: true,
      showContextMenu: true,
    },
    canvas: {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      stencil: true,
    },
  };
}

/** Cache on the function object — not a module binding, so dual-runtime safe. */
function defaultConfig(): ResolvedMolvisConfig {
  const fn = defaultConfig as typeof defaultConfig & {
    _cache?: ResolvedMolvisConfig;
  };
  if (fn._cache === undefined) {
    fn._cache = buildDefaultConfig();
  }
  return fn._cache;
}

/**
 * Default configuration values.
 *
 * Implemented as a Proxy so property reads always go through
 * {@link defaultConfig} (function-local cache) instead of a module-level
 * object that dual-runtime bundling may null out.
 */
export const DEFAULT_CONFIG: ResolvedMolvisConfig = new Proxy(
  {} as ResolvedMolvisConfig,
  {
    get(_target, prop, _receiver) {
      return Reflect.get(defaultConfig(), prop);
    },
    has(_target, prop) {
      return Reflect.has(defaultConfig(), prop);
    },
    ownKeys() {
      return Reflect.ownKeys(defaultConfig());
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(defaultConfig(), prop);
    },
  },
);

/**
 * Helper to create config.
 * Merges user config with defaults.
 */
export function defaultMolvisConfig(config: MolvisConfig = {}): MolvisConfig {
  const d = defaultConfig();
  // Always keep "view" even if the host passes a custom enabledModes list.
  const enabledModes = Array.from(
    new Set<ModeType>([
      "view" as ModeType,
      ...(config.enabledModes ?? d.enabledModes),
    ]),
  );
  return {
    showUI: config.showUI ?? d.showUI,
    useRightHandedSystem: config.useRightHandedSystem ?? d.useRightHandedSystem,
    gui: config.gui ?? d.gui,
    engineOwnership: config.engineOwnership ?? d.engineOwnership,
    interactive: config.interactive ?? d.interactive,
    decorations: config.decorations ?? d.decorations,
    enabledModes,
    // Carry the injected engine reference through verbatim (gui:false only).
    engine: config.engine,
    ui: {
      showModePanel: config.ui?.showModePanel ?? d.ui.showModePanel,
      showViewPanel: config.ui?.showViewPanel ?? d.ui.showViewPanel,
      showInfoPanel: config.ui?.showInfoPanel ?? d.ui.showInfoPanel,
      showPerfPanel: config.ui?.showPerfPanel ?? d.ui.showPerfPanel,
      showTrajPanel: config.ui?.showTrajPanel ?? d.ui.showTrajPanel,
      showContextMenu: config.ui?.showContextMenu ?? d.ui.showContextMenu,
      contextMenu: config.ui?.contextMenu,
    },
    canvas: {
      antialias: config.canvas?.antialias ?? d.canvas.antialias,
      alpha: config.canvas?.alpha ?? d.canvas.alpha,
      preserveDrawingBuffer:
        config.canvas?.preserveDrawingBuffer ?? d.canvas.preserveDrawingBuffer,
      stencil: config.canvas?.stencil ?? d.canvas.stencil,
    },
  };
}

/** Whether a mode is permitted by a resolved or partial configuration. */
export function isModeEnabled(config: MolvisConfig, mode: ModeType): boolean {
  return (config.enabledModes ?? defaultConfig().enabledModes).includes(mode);
}
