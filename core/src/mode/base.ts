import {
  PointerInfo,
  PointerEventTypes,
  KeyboardInfo,
  KeyboardEventTypes,
  Observer,
  Vector2,
  AbstractMesh
} from "@babylonjs/core";

import { Molvis } from "@molvis/core";

enum ModeType {
  Edit = "edit",
  View = "view",
  Select = "select",
  Manupulate = "manupulate",
}

abstract class BaseMode {
  name: ModeType;

  private _app: Molvis;
  private _pointer_observer: Observer<PointerInfo>;
  private _kb_observer: Observer<KeyboardInfo>;
  private _pointer_down_xy: Vector2 = new Vector2();
  private _pointer_up_xy: Vector2 = new Vector2();
  private _contextMenuOpen = false;
  private _lastContextMenuXY: Vector2 | null = null;

  constructor(name: ModeType, app: Molvis) {
    this._app = app;
    this.name = name;
    this._pointer_observer = this.register_pointer_events();
    this._kb_observer = this.register_keyboard_events();
    this.init_context_menu();
  }

  private get scene() {
    return this._app.world.scene;
  }

  protected get app() {
    return this._app;
  }

  protected get gui() {
    return this._app.gui;
  }

  protected get system() {
    return this._app.system;
  }

  protected get world() {
    return this._app.world;
  }

  private get _is_dragging() {
    return this._pointer_up_xy.subtract(this._pointer_down_xy).length() > 0.2;
  }

  // protected get context_menu() {
  //   return this.gui.contextMenu;
  // }

  protected init_context_menu() { }

  public finish() {
    this.unregister_pointer_events();
    this.unregister_keyboard_events();
  }

  private unregister_pointer_events = () => {
    const is_successful = this.scene.onPointerObservable.remove(
      this._pointer_observer,
    );
    if (!is_successful) {
    }
  };

  private unregister_keyboard_events = () => {
    const is_successful = this.scene.onKeyboardObservable.remove(
      this._kb_observer,
    );
    if (!is_successful) {
    }
  };

  private register_pointer_events() {
    return this.scene.onPointerObservable.add((pointerInfo: PointerInfo) => {
      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERDOWN:
          this._on_pointer_down(pointerInfo);
          break;
        case PointerEventTypes.POINTERUP:
          this._on_pointer_up(pointerInfo);
          break;
        case PointerEventTypes.POINTERMOVE:
          this._on_pointer_move(pointerInfo);
          break;
        case PointerEventTypes.POINTERWHEEL:
          this._on_pointer_wheel(pointerInfo);
          break;
        case PointerEventTypes.POINTERPICK:
          this._on_pointer_pick(pointerInfo);
          break;
        case PointerEventTypes.POINTERTAP:
          this._on_pointer_tap(pointerInfo);
          break;
        case PointerEventTypes.POINTERDOUBLETAP:
          this._on_pointer_double_tap(pointerInfo);
          break;
      }
    });
  }

  private register_keyboard_events = () => {
    return this.scene.onKeyboardObservable.add((kbInfo: KeyboardInfo) => {
      switch (kbInfo.type) {
        case KeyboardEventTypes.KEYDOWN:
          if (kbInfo.event.key === "Escape" && this._contextMenuOpen) {
            this.hideContextMenu();
            this._contextMenuOpen = false;
          }
          switch (kbInfo.event.key) {
            case "e":
              this._on_press_e();
              break;
            case "q":
              this._on_press_q();
              break;
          }
          break;
      }
    });
  };

  // 子类需实现：显示/隐藏菜单
  protected abstract showContextMenu(x: number, y: number): void;
  protected abstract hideContextMenu(): void;
  protected isContextMenuOpen(): boolean { return this._contextMenuOpen; }

  _on_pointer_down(pointerInfo: PointerInfo): void {
    this._pointer_down_xy = this.get_pointer_xy();
    // 左键点击时关闭菜单
    if (this._contextMenuOpen && pointerInfo.event.button === 0) {
      this.hideContextMenu();
      this._contextMenuOpen = false;
    }
  }

  _on_pointer_up(pointerInfo: PointerInfo): void {
    this._pointer_up_xy = this.get_pointer_xy();
    // 右键单击且未拖动时弹出菜单
    if (pointerInfo.event.button === 2 && !this._is_dragging) {
      pointerInfo.event.preventDefault();
      const { x, y } = pointerInfo.event;
      this.showContextMenu(x, y);
      this._contextMenuOpen = true;
      this._lastContextMenuXY = new Vector2(x, y);
    }
    // 再次右键关闭菜单
    else if (pointerInfo.event.button === 2 && this._contextMenuOpen) {
      this.hideContextMenu();
      this._contextMenuOpen = false;
    }
  }

  _on_pointer_move(pointerInfo: PointerInfo): void {}
  _on_pointer_wheel(pointerInfo: PointerInfo): void {}
  _on_pointer_pick(pointerInfo: PointerInfo): void {}
  _on_pointer_tap(pointerInfo: PointerInfo): void {}
  _on_pointer_double_tap(pointerInfo: PointerInfo): void {}
  _on_press_e(): void {}
  _on_press_q(): void {}

  protected get_pointer_xy(): Vector2 {
    return new Vector2(this.scene.pointerX, this.scene.pointerY);
  }

  protected pick_mesh(): AbstractMesh | null {
    const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
    if (pickResult.hit) {
      return pickResult.pickedMesh
    }
    return null;
  }
}

export { ModeType };
export { BaseMode };