import type { ListBladeApi, TextBladeApi } from "tweakpane";
import { Pane } from "tweakpane";
import {
  MeshBuilder,
  StandardMaterial,
  Color3,
} from "@babylonjs/core";
import type { PointerInfo, Mesh, AbstractMesh, Vector3 } from "@babylonjs/core";
import { get_vec3_from_screen_with_depth } from "./utils";
import { BaseMode, ModeType } from "./base";
import type { Molvis } from "@molvis/core";
import type { Atom } from "../system/item";
import { draw_atom, draw_bond } from "../artist";
import { System } from "../system";

class EditModeMenu {
  private container: HTMLDivElement;
  private pane: Pane;
  private elementBlade!: TextBladeApi<string>;
  private bondOrderBlade!: ListBladeApi<number>;

  constructor() {
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
    const elementFolder = this.pane.addFolder({ title: "Element" });
    this.elementBlade = elementFolder.addBlade({
      view: "text",
      label: "symbol",
      parse: (v: string) => v,
      value: "C"
    }) as TextBladeApi<string>;

    const bondFolder = this.pane.addFolder({ title: "Bond" });
    this.bondOrderBlade = bondFolder.addBlade({
      view: "list",
      label: "order",
      options: [
        { text: "single", value: 1 },
        { text: "double", value: 2 },
        { text: "triple", value: 3 },
      ],
      value: 1
    }) as ListBladeApi<number>;
  }

  // 提供getter和setter，直接从tweakpane的binding获取/设置值
  get element(): string {
    return this.elementBlade.value as string;
  }
  set element(v: string) {
    this.elementBlade.value = v;
  }
  
  get bondOrder(): number {
    return this.bondOrderBlade.value as number;
  }
  set bondOrder(v: number) {
    this.bondOrderBlade.value = v;
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
  private _startAtomMesh: AbstractMesh | null = null;
  private _dragAtomMesh: Mesh | null = null;
  private _dragBondMesh: Mesh | null = null;

  private menu: EditModeMenu;

  constructor(app: Molvis) {
    super(ModeType.Edit, app);
    this.menu = new EditModeMenu();
  }
  
  get element(): string {
    return this.menu.element;
  }
  set element(v: string) {
    this.menu.element = v;
  }
  get bondOrder(): number {
    return this.menu.bondOrder;
  }
  set bondOrder(v: number) {
    this.menu.bondOrder = v;
  }
  protected showContextMenu(x: number, y: number): void {
    this.menu?.show(x, y);
  }
  protected hideContextMenu(): void {
    this.menu?.hide();
  }

  protected override _on_left_down(_pointerInfo: PointerInfo): void {
    const mesh = this.pick_mesh();
    if (mesh?.name.startsWith("atom:")) {
      this._startAtomMesh = mesh;
      this.world.camera.detachControl();  // TODO: may disable when dragging
    }
  }

  override _on_pointer_move(pointerInfo: PointerInfo) {
    
    if (this._startAtomMesh && pointerInfo.event.buttons === 1) {
      const mesh = this.pick_mesh();
      let hoverAtomMesh: AbstractMesh | null = null;
      if (mesh?.name.startsWith("atom:")) {
        hoverAtomMesh = mesh;
      }

      if (hoverAtomMesh) {
        // 悬停在其他原子上：隐藏拖拽原子，显示键连接到目标原子
        if (this._dragAtomMesh) {
          this._dragAtomMesh.isVisible = false;
        }
        this._updatePreviewBond([
          this._startAtomMesh.position,
          hoverAtomMesh.position,
        ]);
      } else {
        // 拖拽到空白区域：显示拖拽原子和键
        const xyz = get_vec3_from_screen_with_depth(
          this.world.scene,
          pointerInfo.event.clientX,
          pointerInfo.event.clientY,
          10,
        );
        this._updatePreviewAtom(xyz);
        this._updatePreviewBond([this._startAtomMesh.position, xyz]);
      }
    }
    super._on_pointer_move(pointerInfo);
  }

  private _updatePreviewAtom(xyz: Vector3): void {
          if (!this._dragAtomMesh) {
            this._dragAtomMesh = MeshBuilder.CreateSphere(
              "preview_atom",
              { diameter: 0.5 },
              this.world.scene,
            );
            const mat = new StandardMaterial(
              "preview_atom_mat",
              this.world.scene,
            );
            mat.diffuseColor = new Color3(0.5, 0.5, 0.5);
            mat.alpha = 0.8
            this._dragAtomMesh.material = mat;
          }
          this._dragAtomMesh.position = xyz;
          this._dragAtomMesh.isVisible = true;
        }

  private _updatePreviewBond(path: Vector3[]): void {
    if (!this._dragBondMesh) {
      this._dragBondMesh = MeshBuilder.CreateTube(
        "preview_bond",
        { path, radius: 0.05, updatable: true },
        this.world.scene,
      );
      const bmat = new StandardMaterial(
        "preview_bond_mat",
        this.world.scene,
      );
      bmat.diffuseColor = new Color3(0.8, 0.8, 0.8);
      bmat.alpha = 0.8;
      this._dragBondMesh.material = bmat;
    } else {
      MeshBuilder.CreateTube("preview_bond", {
        path,
        instance: this._dragBondMesh,
      });
    }
  }

  protected override _on_left_up(pointerInfo: PointerInfo): void {
    if (this._startAtomMesh) {
      // 从 startAtomMesh 获取对应的原子对象
      const startAtomName = this._startAtomMesh.name.substring(5);
      const startAtom = this.system.current_frame.atoms.find((a) => a.name === startAtomName);
      
      if (!startAtom) {
        // 如果找不到开始原子，清理状态并返回
        this._clearDragState();
        return;
      }

      // 重新检查鼠标位置下面是否有原子
      const mesh = this.pick_mesh();
      let targetAtom: Atom | null = null;
      
      if (mesh?.name.startsWith("atom:")) {
        const name = mesh.name.substring(5);
        const atom = this.system.current_frame.atoms.find(
          (a) => a.name === name,
        );
        if (atom && atom !== startAtom) {
          targetAtom = atom;
        }
      }
      
      if (targetAtom) {
        // 连接到现有原子
        const bond = this.system.current_frame.add_bond(
          startAtom,
          targetAtom,
          { order: this.bondOrder },
        );
        draw_bond(this.app, bond, { order: this.bondOrder, update: true });
        console.log(`Created bond between ${startAtom.name} and ${targetAtom.name}`);
      } else if (this._dragAtomMesh) {
        // 创建新原子并连接
        const xyz = this._dragAtomMesh.position;
        const type = this.element;
        const newAtom = this.system.current_frame.add_atom(
          `a_${System.random_atom_id()}`,
          xyz.x,
          xyz.y,
          xyz.z,
          { type, element: type },
        );
        draw_atom(this.app, newAtom, {});
        const bond = this.system.current_frame.add_bond(
          startAtom,
          newAtom,
          { order: this.bondOrder },
        );
        draw_bond(this.app, bond, { order: this.bondOrder, update: true });
        console.log(`Created bond between ${startAtom.name} and ${newAtom.name}`);
      }

      this._clearDragState();
    } else if (!this._startAtomMesh && !this._is_dragging) {
      // 点击空白区域：直接创建原子
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
        { type: this.element, element: this.element },
      );
      draw_atom(this.app, atom, {});
    }
    
    // 调用父类方法处理基本的左键逻辑
    super._on_left_up(pointerInfo);
  }

  private _clearDragState(): void {
    if (this._dragAtomMesh) {
      this._dragAtomMesh.dispose();
      this._dragAtomMesh = null;
    }
    if (this._dragBondMesh) {
      this._dragBondMesh.dispose();
      this._dragBondMesh = null;
    }

    this.world.camera.attachControl(
      this.world.scene.getEngine().getRenderingCanvas(),
      false,
    );

    this._startAtomMesh = null;
  }

  protected override _on_right_up(pointerInfo: PointerInfo): void {
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
    super._on_right_up(pointerInfo);
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

}

export { EditMode };
