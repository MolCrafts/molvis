import { BaseMode, ModeType } from "./base";
import { Molvis, draw_frame } from "@molvis/core";
import { PointerInfo } from "@babylonjs/core";
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
    this.pane.children.forEach((c) => this.pane.remove(c));

    const viewFolder = this.pane.addFolder({ title: "View" });
    const options = [
      { text: "perspective", value: "perspective" },
      { text: "ortho", value: "ortho" },
      { text: "front", value: "front" },
      { text: "back", value: "back" },
      { text: "left", value: "left" },
      { text: "right", value: "right" },
    ];

    viewFolder
      .addBlade({
        view: "list",
        label: "mode",
        options,
        value: "perspective",
      })
      .on("change", (ev) => {
        switch (ev.value) {
          case "perspective":
            this.vm.world.setPerspective();
            break;
          case "ortho":
            this.vm.world.setOrthographic();
            break;
          case "front":
            this.vm.world.viewFront();
            break;
          case "back":
            this.vm.world.viewBack();
            break;
          case "left":
            this.vm.world.viewLeft();
            break;
          case "right":
            this.vm.world.viewRight();
            break;
        }
      });

    const tools = this.pane.addFolder({ title: "Tools" });
    tools.addButton({ title: "snapshot" }).on("click", () => {
      this.vm.world.takeScreenShot();
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
  constructor(app: Molvis) {
    super(ModeType.View, app);
    this.menu = new ViewModeMenu(this);
  }

  protected showContextMenu(x: number, y: number): void {
    this.menu.show(x, y);
  }
  protected hideContextMenu(): void {
    this.menu.hide();
  }

  override _on_pointer_down(pointerInfo: PointerInfo) {
    super._on_pointer_down(pointerInfo);
    if (pointerInfo.event.button === 0) {
    }
  }

  override _on_pointer_up(pointerInfo: PointerInfo) {
    super._on_pointer_up(pointerInfo);
  }

  override _on_pointer_move(pointerInfo: PointerInfo) {
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
