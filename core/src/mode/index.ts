import { KeyboardEventTypes, type KeyboardInfo } from "@babylonjs/core";
import type { MolvisApp } from "../app";
import { isModeEnabled } from "../config";
import { logger } from "../utils/logger";
import type { BaseMode } from "./base";
import { ModeType } from "./base";
import { EditMode } from "./edit";
import { ManipulateMode } from "./manipulate";
import { MeasureMode } from "./measure";
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

class ModeManager {
  private _app: MolvisApp;
  private _mode: BaseMode | null = null;

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

  public switch_mode = (mode: ModeType) => {
    if (!this.isModeEnabled(mode)) {
      logger.warn(`Mode is disabled by configuration: ${mode}`);
      return;
    }
    if (this._mode?.name === mode) return;

    if (this._mode) this._mode.finish();

    switch (mode) {
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
    this._app.events?.emit("mode-change", mode);
  };

  public get currentMode(): BaseMode | null {
    return this._mode;
  }

  public get currentModeName(): string {
    return this._mode?.name || ModeType.View;
  }
}

export { ModeManager, ModeType };
