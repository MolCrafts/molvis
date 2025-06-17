import { BaseMode, ModeType } from "./base";
import type { Molvis } from "@molvis/core";
import { draw_frame } from "@molvis/core";
import type { PointerInfo } from "@babylonjs/core";
import { Pane } from "tweakpane";

class ViewModeMenu {
  private container: HTMLDivElement;
  private pane: Pane;

  constructor(private vm: ViewMode) {
    this.container = document.createElement("div");
    this.container.style.position = "absolute";
    document.body.appendChild(this.container);
    this.pane = new Pane({ container: this.container });
    this.pane.hidden = true;
    this.build();
  }

  private build() {
    for (const c of this.pane.children) {
      this.pane.remove(c);
    }

    const viewFolder = this.pane.addFolder({ title: "View" });
    
    viewFolder.addBinding(this.vm, "currentViewMode", {
      label: "mode",
      options: {
        perspective: "perspective",
        ortho: "ortho", 
        front: "front",
        back: "back",
        left: "left",
        right: "right",
      },
    });

    const tools = this.pane.addFolder({ title: "Tools" });
    tools.addButton({ title: "snapshot" }).on("click", () => {
      this.vm.takeScreenShot();
    });
  }

  public show(x: number, y: number) {
    this.container.style.left = `${x}px`;
    this.container.style.top = `${y}px`;
    this.pane.hidden = false;
  }

  public hide() {
    this.pane.hidden = true;
  }
}

class ViewMode extends BaseMode {
  private menu: ViewModeMenu;
  private viewMode = "perspective";
  
  constructor(app: Molvis) {
    super(ModeType.View, app);
    this.menu = new ViewModeMenu(this);
  }

  get currentViewMode(): string {
    return this.viewMode;
  }
  
  set currentViewMode(value: string) {
    this.viewMode = value;
    switch (value) {
      case "perspective":
        this.setPerspective();
        break;
      case "ortho":
        this.setOrthographic();
        break;
      case "front":
        this.viewFront();
        break;
      case "back":
        this.viewBack();
        break;
      case "left":
        this.viewLeft();
        break;
      case "right":
        this.viewRight();
        break;
    }
  }

  protected showContextMenu(x: number, y: number): void {
    this.menu.show(x, y);
  }
  protected hideContextMenu(): void {
    this.menu.hide();
  }

  // 公共方法供菜单使用
  public setPerspective(): void {
    this.world.setPerspective();
  }
  
  public setOrthographic(): void {
    this.world.setOrthographic();
  }
  
  public viewFront(): void {
    this.world.viewFront();
  }
  
  public viewBack(): void {
    this.world.viewBack();
  }
  
  public viewLeft(): void {
    this.world.viewLeft();
  }
  
  public viewRight(): void {
    this.world.viewRight();
  }
  
  public takeScreenShot(): void {
    this.world.takeScreenShot();
  }

  override _on_pointer_down(pointerInfo: PointerInfo) {
    super._on_pointer_down(pointerInfo);
    if (pointerInfo.event.button === 0) {
    }
  }

  override _on_pointer_up(pointerInfo: PointerInfo) {
    super._on_pointer_up(pointerInfo);
  }

  override _on_pointer_move(_pointerInfo: PointerInfo) {
    const mesh = this.pick_mesh();
    const name = mesh ? mesh.name : "";
    this.gui.updateInfoText(name);
  }

  _on_press_e() {
    const frame = this.system.next_frame();
    draw_frame(this.app, frame, { atoms: {}, bonds: {}, clean: true });
    this.gui.updateFrameIndicator(
      this.system.current_frame_index,
      this.system.n_frames,
    );
  }

  _on_press_q() {
    const frame = this.system.prev_frame();
    draw_frame(this.app, frame, { atoms: {}, bonds: {}, clean: true });
    this.gui.updateFrameIndicator(
      this.system.current_frame_index,
      this.system.n_frames,
    );
  }
}

export { ViewMode };
