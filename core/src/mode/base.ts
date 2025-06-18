import {
  PointerEventTypes,
  KeyboardEventTypes,
  Vector2,
} from "@babylonjs/core";
import type {
  PointerInfo,
  KeyboardInfo,
  AbstractMesh,
  Observer,
} from "@babylonjs/core";

import type { Molvis } from "@molvis/core";

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
  protected _pointer_down_xy: Vector2 = new Vector2();
  protected _pointer_up_xy: Vector2 = new Vector2();
  private _contextMenuOpen = false;

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

  protected get _is_dragging() {
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
          if ((kbInfo.event.key === "Escape" || kbInfo.event.key === "Enter") && this._contextMenuOpen) {
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
  
  // 提供给子类的方法来管理菜单状态
  protected setContextMenuState(open: boolean): void {
    this._contextMenuOpen = open;
  }

  _on_pointer_down(pointerInfo: PointerInfo): void {
    this._pointer_down_xy = this.get_pointer_xy();
    
    // 根据按键类型调用相应的处理方法
    if (pointerInfo.event.button === 0) {
      this._on_left_down(pointerInfo);
    } else if (pointerInfo.event.button === 2) {
      this._on_right_down(pointerInfo);
    }
    
    // 通用菜单操作：左键点击时关闭菜单
    if (this._contextMenuOpen && pointerInfo.event.button === 0) {
      this.hideContextMenu();
      this._contextMenuOpen = false;
    }
  }

  _on_pointer_up(pointerInfo: PointerInfo): void {
    this._pointer_up_xy = this.get_pointer_xy();
    
    // 根据按键类型调用相应的处理方法
    if (pointerInfo.event.button === 0) {
      this._on_left_up(pointerInfo);
    } else if (pointerInfo.event.button === 2) {
      this._on_right_up(pointerInfo);
    }
  }

  // 子类可重写的按键处理方法
  protected _on_left_down(_pointerInfo: PointerInfo): void {
    // 默认实现为空，子类可重写
  }

  protected _on_left_up(_pointerInfo: PointerInfo): void {
    // 默认左键抬起时关闭菜单
    if (this._contextMenuOpen) {
      this.hideContextMenu();
      this._contextMenuOpen = false;
    }
  }

  protected _on_right_down(_pointerInfo: PointerInfo): void {
    // 默认实现为空，子类可重写
  }

  protected _on_right_up(pointerInfo: PointerInfo): void {
    // 默认右键处理：右键单击且未拖动时切换菜单状态
    if (!this._is_dragging) {
      pointerInfo.event.preventDefault();
      
      if (this._contextMenuOpen) {
        // 如果菜单已打开，关闭它
        this.hideContextMenu();
        this._contextMenuOpen = false;
      } else {
        // 如果菜单已关闭，打开它
        const { x, y } = pointerInfo.event;
        this.showContextMenu(x, y);
        this._contextMenuOpen = true;
      }
    }
  }

  _on_pointer_move(_pointerInfo: PointerInfo): void {
    // 默认显示原子信息
    const mesh = this.pick_mesh();
    const name = mesh ? mesh.name : "";
    if (this.gui) {
      this.gui.updateInfoText(name);
    }
  }
  _on_pointer_wheel(_pointerInfo: PointerInfo): void {}
  _on_pointer_pick(_pointerInfo: PointerInfo): void {}
  _on_pointer_tap(_pointerInfo: PointerInfo): void {}
  _on_pointer_double_tap(_pointerInfo: PointerInfo): void {}
  _on_press_e(): void {
    const frame = this.system.next_frame();
    const { draw_frame } = require("@molvis/core");
    draw_frame(this.app, frame, { atoms: {}, bonds: {}, clean: true });
    if (this.gui) {
      this.gui.updateFrameIndicator(
        this.system.current_frame_index,
        this.system.n_frames,
      );
    }
  }
  
  _on_press_q(): void {
    const frame = this.system.prev_frame();
    const { draw_frame } = require("@molvis/core");
    draw_frame(this.app, frame, { atoms: {}, bonds: {}, clean: true });
    if (this.gui) {
      this.gui.updateFrameIndicator(
        this.system.current_frame_index,
        this.system.n_frames,
      );
    }
  }

  protected get_pointer_xy(): Vector2 {
    return new Vector2(this.scene.pointerX, this.scene.pointerY);
  }

  protected pick_mesh(): AbstractMesh | null {
    const scene = this.world.scene;
    
    // 使用更严格的射线检测参数
    const pickResult = scene.pick(
      scene.pointerX, 
      scene.pointerY,
      (mesh) => {
        // 只检测原子网格，提高精度
        return mesh.name.startsWith("atom:") && mesh.isEnabled() && mesh.isVisible;
      },
      false, // fastCheck = false 使用更精确的检测
      this.world.camera
    );
    
    return pickResult.hit ? pickResult.pickedMesh : null;
  }
}

export { ModeType };
export { BaseMode };