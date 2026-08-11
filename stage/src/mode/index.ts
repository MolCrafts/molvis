import { KeyboardEventTypes, type KeyboardInfo } from "@babylonjs/core";
import type { MolvisApp } from "../app";
import { isModeEnabled } from "../config";
import { logger } from "../utils/logger";
import type { BaseMode } from "./base";
import { EditMode } from "./edit";
import { ManipulateMode } from "./manipulate";
import { MeasureMode } from "./measure";
import { ALL_MODE_TYPES, type ModeId, ModeType } from "./mode_type";
import { SelectMode } from "./select";
import { ViewMode } from "./view";

/**
 * Single source of truth mapping digit keys → modes. Shared by keyboard
 * dispatch here and {@link MolvisApp.setMode} so the two cannot drift
 * (they previously disagreed: `4`/`5` were swapped between Measure and
 * Manipulate). Order matches the documented table in `.claude/notes/core-arch.md`.
 */
export const KEY_TO_MODE: Readonly<Record<string, ModeType>> = {
  "1": ModeType.View,
  "2": ModeType.Select,
  "3": ModeType.Edit,
  "4": ModeType.Manipulate,
  "5": ModeType.Measure,
};

/**
 * What this manager requires of a plugin-supplied mode: an id and the two
 * lifecycle calls. Nothing else is ever touched.
 *
 * Deliberately not `BaseMode`. That class's abstract
 * `createContextMenuController()` must return a `ContextMenuController`
 * whose concrete implementations are internal to this package, so no
 * external plugin can extend it — a factory typed `=> BaseMode` was
 * unimplementable from a plugin, and the plugin repos papered over it by
 * re-declaring the factory as returning `unknown`. `BaseMode` satisfies
 * this interface structurally, so built-in modes are unaffected.
 */
export interface PluginMode {
  readonly name: ModeId;
  start(): void;
  finish(): void;
}

/** Factory for a plugin-supplied interaction mode instance. */
export type PluginModeFactory = (app: MolvisApp) => PluginMode;

class ModeManager {
  private _app: MolvisApp;
  private _mode: BaseMode | PluginMode | null = null;
  private _pluginModes = new Map<string, PluginModeFactory>();

  constructor(app: MolvisApp) {
    this._app = app;
    this.switch_mode(ModeType.View);
    this._register_keyboard_events();
  }

  private get _scene() {
    return this._app.world.scene;
  }

  private _register_keyboard_events = () => {
    this._scene.onKeyboardObservable.add((kbInfo: KeyboardInfo) => {
      if (kbInfo.type !== KeyboardEventTypes.KEYDOWN) return;
      const mode = KEY_TO_MODE[kbInfo.event.key];
      if (mode) this.switch_mode(mode);
    });
  };

  public isModeEnabled(mode: ModeType): boolean {
    return isModeEnabled(this._app.config, mode);
  }

  /**
   * Register a plugin interaction mode under a string id (not a built-in
   * {@link ModeType}). Returns a disposer that unregisters and leaves the
   * mode if it is currently active.
   */
  public registerPluginMode(
    id: string,
    factory: PluginModeFactory,
  ): () => void {
    if (!id || typeof id !== "string") {
      throw new Error("Plugin mode id must be a non-empty string");
    }
    if (ALL_MODE_TYPES.some((builtIn) => builtIn === id)) {
      throw new Error(
        `Plugin mode id '${id}' collides with a built-in ModeType`,
      );
    }
    this._pluginModes.set(id, factory);
    return () => {
      this._pluginModes.delete(id);
      if (this._mode?.name === id) {
        this.switch_mode(ModeType.View);
      }
    };
  }

  public switch_mode = (mode: ModeId) => {
    const pluginFactory = this._pluginModes.get(mode);
    if (pluginFactory) {
      if (this._mode?.name === mode) return;
      if (this._mode) this._mode.finish();
      this._mode = pluginFactory(this._app);
      this._mode?.start();
      this._app.events?.emit("mode-change", mode);
      return;
    }

    const builtIn = mode as ModeType;
    if (!this.isModeEnabled(builtIn)) {
      logger.warn(`Mode is disabled by configuration: ${mode}`);
      return;
    }
    if (this._mode?.name === builtIn) return;

    if (this._mode) this._mode.finish();

    switch (builtIn) {
      case ModeType.View:
        this._mode = new ViewMode(this._app);
        break;
      case ModeType.Select:
        this._mode = new SelectMode(this._app);
        break;
      case ModeType.Edit:
        this._mode = new EditMode(this._app);
        break;
      case ModeType.Measure:
        this._mode = new MeasureMode(this._app);
        break;
      case ModeType.Manipulate:
        this._mode = new ManipulateMode(this._app);
        break;

      default:
        throw new Error(`unknown mode: ${mode}`);
    }

    this._mode?.start();
    this._app.events?.emit("mode-change", builtIn);
  };

  public get currentMode(): BaseMode | PluginMode | null {
    return this._mode;
  }

  public get currentModeName(): string {
    return this._mode?.name || ModeType.View;
  }

  /** Ids of currently registered plugin modes. */
  public listPluginModes(): string[] {
    return Array.from(this._pluginModes.keys()).sort();
  }
}

export type { ManipulateTool } from "./manipulate";
export { ALL_MODE_TYPES, type ModeId, ModeType } from "./mode_type";
export {
  cameraFacingBasis,
  identityPlacementBasis,
  orientLocalOffset,
  type PlacementBasis,
} from "./placement_orientation";
export {
  intersectRayWithPlane,
  type PointerSpacePositionInput,
  resolvePointerSpacePosition,
  screenAlignedPlaneNormal,
  screenAlignedPlaneOrigin,
} from "./placement_position";
export {
  eulerDegreesToQuaternion,
  quaternionToEulerDegrees,
  rotateAroundPivot,
  rotatePointsAroundPivot,
  selectionCentroid,
  translatePoint,
  translatePoints,
  type Vec3,
} from "./selection_transform";
export { ModeManager };
