import { KeyboardEventTypes, type KeyboardInfo } from "@babylonjs/core";

import { Logger } from "tslog";
import type { Molvis } from "@molvis/core";

const logger = new Logger({ name: "molvis-core" });

import type { BaseMode } from "./base";
import { ModeType } from "./base";
import { ViewMode } from "./view";
import { EditMode } from "./edit";

class ModeManager {
  private _app: Molvis;
  private _mode: BaseMode;

  constructor(app: Molvis) {
    this._app = app;
    this._mode = this.switch_mode(ModeType.View);
    this._register_keyboard_events();
  }

  private get _scene() {
    return this._app.world.scene;
  }

  private _register_keyboard_events = () => {
    this._scene.onKeyboardObservable.add((kbInfo: KeyboardInfo) => {
      switch (kbInfo.type) {
        case KeyboardEventTypes.KEYDOWN:
          switch (kbInfo.event.key) {
            case "1":
              this._mode = this.switch_mode(ModeType.View);
              break;
            // case "2":
            //     logger.info("select mode");
            //     this.switch_mode(ModeType.Select);
            //     break;
            case "3":
              this._mode = this.switch_mode(ModeType.Edit);
              break;
            // case "4":
            //   this._mode = this.switch_mode("manupulate");
          }
          break;
      }
    });
    // return new ViewMode(this);
  };

  public switch_mode = (mode: ModeType) => {
    if (this._mode) this._mode.finish();
    let _mode;
    switch (mode) {
      case ModeType.Edit:
        _mode = new EditMode(this._app);
        break;
      case ModeType.View:
        _mode = new ViewMode(this._app);
        break;
      // case "select":
      //     this._mode = new SelectMode(this._system, this._world);
      //     break;
      // case "manupulate":

      default:
        throw new Error(`unknown mode: ${mode}`);
    }
    return _mode;
  };
}

export { ModeManager };
