import { Pane } from "tweakpane";
import {
  PointerInfo,
  MeshBuilder,
  StandardMaterial,
  Color3,
  type Mesh,
} from "@babylonjs/core";
import { get_vec3_from_screen_with_depth } from "./utils";
import { BaseMode, ModeType } from "./base";
import type { Molvis, Atom } from "@molvis/core";
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
    this.pane.children.forEach((c) => this.pane.remove(c));
    
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

  private _element: string = "C";
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

  override _on_pointer_down(pointerInfo: PointerInfo) {
    super._on_pointer_down(pointerInfo);
    if (pointerInfo.event.button === 0) this.menu?.hide();
    if (pointerInfo.event.button === 0) {
      const mesh = this.pick_mesh();
      if (mesh && mesh.name.startsWith("atom:")) {
        const name = mesh.name.substring(5);
        this._startAtom =
          this.system.current_frame.atoms.find((a) => a.name === name) || null;
        this.world.camera.detachControl(
          this.world.scene.getEngine().getRenderingCanvas(),
        );
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
      if (mesh && mesh.name.startsWith("atom:")) {
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

  override _on_pointer_up(pointerInfo: PointerInfo) {
    super._on_pointer_up(pointerInfo);
    if (pointerInfo.event.button === 0 && this._startAtom) {
      if (this._hoverAtom) {
        const bond = this.system.current_frame.add_bond(
          this._startAtom,
          this._hoverAtom,
          { order: this._bondOrder },
        );
        draw_bond(this.app, bond, { order: this._bondOrder, update: true });
      } else if (this._previewAtom) {
        const xyz = this._previewAtom.position;
        const type = this._startAtom.get("type") as string | undefined;
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
    } else if (
      pointerInfo.event.button === 0 &&
      this._pendingAtom &&
      !this._is_dragging
    ) {
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
    } else if (pointerInfo.event.button === 0 && this._pendingAtom) {
      this._pendingAtom = false;
    } else if (pointerInfo.event.button === 2) {
      if (!this._is_dragging) {
        const mesh = this.pick_mesh();
        if (mesh && mesh.name.startsWith("atom:")) {
          const name = mesh.name.substring(5);
          const atom = this.system.current_frame.atoms.find(
            (a) => a.name === name,
          );
          if (atom) {
            this.system.current_frame.remove_atom(atom);
            for (const m of this.world.scene.meshes.slice()) {
              if (
                m.name === mesh.name ||
                (m.name.startsWith("bond:") && m.name.includes(name))
              ) {
                m.dispose();
              }
            }
          }
        } else if (!mesh) {
          pointerInfo.event.preventDefault();
          this.menu?.show(pointerInfo.event.clientX, pointerInfo.event.clientY);
        }
      }
    }
  }
}

export { EditMode };
