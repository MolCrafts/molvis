import { Pane } from "tweakpane";
import {
  MeshBuilder,
  StandardMaterial,
  Color3,
} from "@babylonjs/core";
import type { PointerInfo, Mesh, AbstractMesh } from "@babylonjs/core";
import { get_vec3_from_screen_with_depth } from "./utils";
import { BaseMode, ModeType } from "./base";
import type { Molvis } from "@molvis/core";
import type { Atom } from "../system/item";
import { draw_atom, draw_bond } from "../artist";
import { System } from "../system";

class EditModeMenu {
  private container: HTMLDivElement;
  private pane: Pane;

  constructor(private em: EditMode) {
    this.container = document.createElement("div");
    this.container.style.position = "absolute";
    document.body.appendChild(this.container);
    this.pane = new Pane({ container: this.container, title: "Edit Mode" });
    this.pane.hidden = false;
    this.build();
  }

  private build() {
    console.log("Building Edit Mode Menu");
    for (const c of this.pane.children) {
      this.pane.remove(c);
    }
    
    // Add element input
    const element = this.pane.addFolder({ title: "Element" });
    element.addBinding(this.em, "element", {
      label: "symbol"
    });

    const bond = this.pane.addFolder({ title: "Bond" });
    bond.addBlade({
      view: "list",
      label: "order",
      options: [
        { text: "single", value: 1 },
        { text: "double", value: 2 },
        { text: "triple", value: 3 },
      ],
      value: this.em.bondOrder,
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

class EditMode extends BaseMode {
  private _startAtom: Atom | null = null;
  private _previewAtom: Mesh | null = null;
  private _previewBond: Mesh | null = null;
  private _hoverAtom: Atom | null = null;
  private _pendingAtom = false;

  private _element = "C";
  private _bondOrder = 1;
  private menu?: EditModeMenu;

  get element(): string {
    return this._element;
  }
  set element(v: string) {
    this._element = v;
  }
  get bondOrder(): number {
    return this._bondOrder;
  }
  set bondOrder(v: number) {
    this._bondOrder = v;
  }
  constructor(app: Molvis) {
    super(ModeType.Edit, app);
    if (typeof document !== "undefined") {
      this.menu = new EditModeMenu(this);
    }
  }

  protected showContextMenu(x: number, y: number): void {
    this.menu?.show(x, y);
  }
  protected hideContextMenu(): void {
    this.menu?.hide();
  }

  override _on_pointer_down(pointerInfo: PointerInfo) {
    super._on_pointer_down(pointerInfo);
    if (pointerInfo.event.button === 0) {
      // 只需关闭菜单，其他逻辑不变
      // this.menu?.hide();
    }
    if (pointerInfo.event.button === 0) {
      const mesh = this.pick_mesh();
      if (mesh?.name.startsWith("atom:")) {
        const name = mesh.name.substring(5);
        this._startAtom =
          this.system.current_frame.atoms.find((a) => a.name === name) || null;
        this.world.camera.detachControl();
        this._hoverAtom = null;
      } else {
        this._pendingAtom = true;
      }
    }
  }

  override _on_pointer_move(pointerInfo: PointerInfo) {
    super._on_pointer_move(pointerInfo);
    if (this._startAtom && pointerInfo.event.buttons === 1) {
      const mesh = this.pick_mesh();
      let hover: Atom | null = null;
      if (mesh?.name.startsWith("atom:")) {
        const name = mesh.name.substring(5);
        const atom = this.system.current_frame.atoms.find(
          (a) => a.name === name,
        );
        if (atom && atom !== this._startAtom) {
          hover = atom;
        }
      }

      if (hover) {
        this._hoverAtom = hover;
        if (this._previewAtom) {
          this._previewAtom.dispose();
          this._previewAtom = null;
        }
        const path = [this._startAtom.xyz, hover.xyz];
        if (!this._previewBond) {
          this._previewBond = MeshBuilder.CreateTube(
            "preview_bond",
            { path, radius: 0.05, updatable: true },
            this.world.scene,
          );
          const bmat = new StandardMaterial(
            "preview_bond_mat",
            this.world.scene,
          );
          bmat.diffuseColor = new Color3(0.8, 0.8, 0.8);
          this._previewBond.material = bmat;
        } else {
          MeshBuilder.CreateTube("preview_bond", {
            path,
            instance: this._previewBond,
          });
        }
      } else {
        this._hoverAtom = null;
        const xyz = get_vec3_from_screen_with_depth(
          this.world.scene,
          pointerInfo.event.clientX,
          pointerInfo.event.clientY,
          10,
        );
        if (!this._previewAtom) {
          this._previewAtom = MeshBuilder.CreateSphere(
            "preview_atom",
            { diameter: 0.5 },
            this.world.scene,
          );
          const mat = new StandardMaterial(
            "preview_atom_mat",
            this.world.scene,
          );
          mat.diffuseColor = new Color3(0.5, 0.5, 0.5);
          this._previewAtom.material = mat;
        }
        this._previewAtom.position = xyz;
        const path = [this._startAtom.xyz, xyz];
        if (!this._previewBond) {
          this._previewBond = MeshBuilder.CreateTube(
            "preview_bond",
            { path, radius: 0.05, updatable: true },
            this.world.scene,
          );
          const bmat = new StandardMaterial(
            "preview_bond_mat",
            this.world.scene,
          );
          bmat.diffuseColor = new Color3(0.8, 0.8, 0.8);
          this._previewBond.material = bmat;
        } else {
          MeshBuilder.CreateTube("preview_bond", {
            path,
            instance: this._previewBond,
          });
        }
      }
    }
  }

  protected override _on_left_click(pointerInfo: PointerInfo): void {
    this.handleLeftClick(pointerInfo);
    // 调用父类方法处理基本的左键逻辑
    super._on_left_click(pointerInfo);
  }

  protected override _on_right_click(pointerInfo: PointerInfo): void {
    // 只在未拖动时处理右键点击
    if (!this._is_dragging) {
      const mesh = this.pick_mesh();
      
      // 如果点击在原子或键上，执行删除操作而不显示菜单
      if (mesh?.name.startsWith("atom:")) {
        this.deleteAtom(mesh);
        return; // 不调用父类方法，阻止菜单显示
      }
      if (mesh?.name.startsWith("bond:")) {
        this.deleteBond(mesh);
        return; // 不调用父类方法，阻止菜单显示
      }
    }
    
    // 如果没有点击在原子或键上，调用父类方法处理菜单切换逻辑
    super._on_right_click(pointerInfo);
  }

  private deleteAtom(mesh: AbstractMesh): void {
    const atomName = mesh.name.substring(5);
    const atom = this.system.current_frame.atoms.find((a) => a.name === atomName);
    if (atom) {
      // 删除与此原子相关的所有键
      const relatedBonds = this.system.current_frame.bonds.filter(
        (bond) => bond.itom === atom || bond.jtom === atom
      );
      
      // 删除键的网格
      for (const bond of relatedBonds) {
        for (let i = 0; ; i++) {
          const bondMesh = this.world.scene.getMeshByName(`bond:${bond.name}:${i}`);
          if (bondMesh) {
            bondMesh.dispose();
          } else {
            break;
          }
        }
      }
      
      // 从系统中删除原子（会自动删除相关的键）
      this.system.current_frame.remove_atom(atom);
      
      // 删除原子网格
      mesh.dispose();
      
      console.log(`Deleted atom: ${atomName}`);
    }
  }

  private deleteBond(mesh: AbstractMesh): void {
    const bondName = mesh.name.split(":")[1]; // 提取键名
    const bond = this.system.current_frame.bonds.find((b) => b.name === bondName);
    if (bond) {
      // 删除所有相关的键网格
      for (let i = 0; ; i++) {
        const bondMesh = this.world.scene.getMeshByName(`bond:${bondName}:${i}`);
        if (bondMesh) {
          bondMesh.dispose();
        } else {
          break;
        }
      }
      
      // TODO: Frame 类需要添加 remove_bond 方法
      console.log(`Deleted bond: ${bondName}`);
    }
  }

  private handleLeftClick(pointerInfo: PointerInfo): void {
    if (this._startAtom) {
      if (this._hoverAtom) {
        const bond = this.system.current_frame.add_bond(
          this._startAtom,
          this._hoverAtom,
          { order: this._bondOrder },
        );
        draw_bond(this.app, bond, { order: this._bondOrder, update: true });
      } else if (this._previewAtom) {
        const xyz = this._previewAtom.position;
        const type = this._startAtom.get("type") as string || "C";
        const newAtom = this.system.current_frame.add_atom(
          `a_${System.random_atom_id()}`,
          xyz.x,
          xyz.y,
          xyz.z,
          { type },
        );
        draw_atom(this.app, newAtom, {});
        const bond = this.system.current_frame.add_bond(
          this._startAtom,
          newAtom,
          { order: this._bondOrder },
        );
        draw_bond(this.app, bond, { order: this._bondOrder, update: true });
      }

      if (this._previewAtom) {
        this._previewAtom.dispose();
        this._previewAtom = null;
      }
      if (this._previewBond) {
        this._previewBond.dispose();
        this._previewBond = null;
      }
      this._hoverAtom = null;

      this.world.camera.attachControl(
        this.world.scene.getEngine().getRenderingCanvas(),
        false,
      );

      this._startAtom = null;
    } else if (this._pendingAtom && !this._is_dragging) {
      const xyz = get_vec3_from_screen_with_depth(
        this.world.scene,
        pointerInfo.event.clientX,
        pointerInfo.event.clientY,
        10,
      );
      const atomName = `a_${System.random_atom_id()}`;
      const atom = this.system.current_frame.add_atom(
        atomName,
        xyz.x,
        xyz.y,
        xyz.z,
        { type: this._element },
      );
      draw_atom(this.app, atom, {});
      this._pendingAtom = false;
    } else if (this._pendingAtom) {
      this._pendingAtom = false;
    }
  }
}

export { EditMode };
