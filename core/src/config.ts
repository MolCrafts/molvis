/**
 * Molvis configuration - simplified
 */

import type { Engine } from "@babylonjs/core";
import type { MolvisApp } from "./app";
import { ModeType } from "./mode/base";
import type { HitResult, MenuItem } from "./mode/types";

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
  hit: HitResult | null;
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
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<Omit<MolvisConfig, "engine">> & {
  ui: Required<Omit<UIConfig, "contextMenu">> & {
    contextMenu?: ContextMenuConfig;
  };
  canvas: Required<CanvasConfig>;
} = {
  showUI: true,
  useRightHandedSystem: true,
  gui: true,
  enabledModes: Object.values(ModeType),
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

/**
 * Helper to create config.
 * Merges user config with defaults.
 */
export function defaultMolvisConfig(config: MolvisConfig = {}): MolvisConfig {
  const enabledModes = Array.from(
    new Set([
      ModeType.View,
      ...(config.enabledModes ?? DEFAULT_CONFIG.enabledModes),
    ]),
  );
  return {
    showUI: config.showUI ?? DEFAULT_CONFIG.showUI,
    useRightHandedSystem:
      config.useRightHandedSystem ?? DEFAULT_CONFIG.useRightHandedSystem,
    gui: config.gui ?? DEFAULT_CONFIG.gui,
    enabledModes,
    // Carry the injected engine reference through verbatim (gui:false only).
    engine: config.engine,
    ui: {
      showModePanel:
        config.ui?.showModePanel ?? DEFAULT_CONFIG.ui.showModePanel,
      showViewPanel:
        config.ui?.showViewPanel ?? DEFAULT_CONFIG.ui.showViewPanel,
      showInfoPanel:
        config.ui?.showInfoPanel ?? DEFAULT_CONFIG.ui.showInfoPanel,
      showPerfPanel:
        config.ui?.showPerfPanel ?? DEFAULT_CONFIG.ui.showPerfPanel,
      showTrajPanel:
        config.ui?.showTrajPanel ?? DEFAULT_CONFIG.ui.showTrajPanel,
      showContextMenu:
        config.ui?.showContextMenu ?? DEFAULT_CONFIG.ui.showContextMenu,
      contextMenu: config.ui?.contextMenu,
    },
    canvas: {
      antialias: config.canvas?.antialias ?? DEFAULT_CONFIG.canvas.antialias,
      alpha: config.canvas?.alpha ?? DEFAULT_CONFIG.canvas.alpha,
      preserveDrawingBuffer:
        config.canvas?.preserveDrawingBuffer ??
        DEFAULT_CONFIG.canvas.preserveDrawingBuffer,
      stencil: config.canvas?.stencil ?? DEFAULT_CONFIG.canvas.stencil,
    },
  };
}

/** Whether a mode is permitted by a resolved or partial configuration. */
export function isModeEnabled(config: MolvisConfig, mode: ModeType): boolean {
  return (config.enabledModes ?? DEFAULT_CONFIG.enabledModes).includes(mode);
}
