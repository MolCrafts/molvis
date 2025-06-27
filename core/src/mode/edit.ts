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
import { Logger } from "tslog";

const logger = new Logger({ name: "molvis-core" });

class EditModeMenu {
  private container: HTMLDivElement | null = null;
  private pane: Pane | null = null;
  private elementBlade: TextBladeApi<string> | null = null;
  private bondOrderBlade: ListBladeApi<number> | null = null;
  private parentContainer: HTMLElement;
  private containerId: string;
  private isBuilt: boolean = false;

  constructor(parentContainer: HTMLElement) {
    this.parentContainer = parentContainer;
    this.containerId = "molvis-edit-menu";
  }

  private build() {
    // Check if container already exists
    const existingContainer = this.parentContainer.querySelector(`#${this.containerId}`) as HTMLDivElement;
    
    if (existingContainer) {
      // Reuse existing container
      this.container = existingContainer;
      // Clean up existing Pane
      if (this.pane) {
        this.pane.dispose();
      }
    } else {
      // Create new container
      this.container = document.createElement("div");
      this.container.id = this.containerId;
      this.container.style.position = "fixed"; // Use fixed positioning to avoid parent container influence
      this.container.className = "MolvisModeMenu";
      this.container.style.zIndex = "9999"; // High z-index to ensure menu is on top
      this.container.style.pointerEvents = "auto"; // Ensure menu is clickable
      this.parentContainer.appendChild(this.container);
    }
    
    // Create new Pane
    this.pane = new Pane({ container: this.container, title: "Edit Mode" });
    this.pane.hidden = true;
    
    // Add controls
    this.elementBlade = this.pane.addBlade({
      view: "text",
      label: "symbol",
      parse: (v: string) => v,
      value: "C"
    }) as TextBladeApi<string>;
    
    this.pane.addBlade({
      view: 'separator',
    });
    
    this.bondOrderBlade = this.pane.addBlade({
      view: "list",
      label: "order",
      options: [
        { text: "single", value: 1 },
        { text: "double", value: 2 },
        { text: "triple", value: 3 },
      ],
      value: 1
    }) as ListBladeApi<number>;
    
    this.isBuilt = true;
  }

  // Provide getter and setter to directly get/set values from tweakpane binding
  get element(): string {
    return this.elementBlade?.value as string || "C";
  }
  set element(v: string) {
    if (this.elementBlade) {
      this.elementBlade.value = v;
    }
  }
  
  get bondOrder(): number {
    return this.bondOrderBlade?.value as number || 1;
  }
  set bondOrder(v: number) {
    if (this.bondOrderBlade) {
      this.bondOrderBlade.value = v;
    }
  }

  public show(x: number, y: number) {
    // Lazy build: only build when first shown
    if (!this.isBuilt) {
      this.build();
    }
    
    if (this.container && this.pane) {
      this.container.style.left = `${x}px`;
      this.container.style.top = `${y}px`;
      this.pane.hidden = false;
    }
  }

  public hide() {
    if (this.pane) {
      this.pane.hidden = true;
    }
  }

  public dispose() {
    if (this.pane) {
      this.pane.dispose();
      this.pane = null;
    }
    // Don't remove container, keep it for reuse
    // if (this.container?.parentNode) {
    //   this.container.parentNode.removeChild(this.container);
    // }
    this.elementBlade = null;
    this.bondOrderBlade = null;
    this.isBuilt = false;
  }
}

class EditMode extends BaseMode {
  private _startAtomMesh: AbstractMesh | null = null;
  private _dragAtomMesh: Mesh | null = null;
  private _dragBondMesh: Mesh | null = null;
  private _hoveredAtomMesh: AbstractMesh | null = null; // Currently hovered atom mesh

  private menu: EditModeMenu;

  constructor(app: Molvis) {
    super(ModeType.Edit, app);
    this.menu = new EditModeMenu(app.uiContainer);
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
      // Simplified ray casting: use improved accuracy
      const pickedMesh = this.pick_mesh();
      let hoverAtomMesh: AbstractMesh | null = null;
      
      if (pickedMesh?.name.startsWith("atom:") && pickedMesh !== this._startAtomMesh) {
        hoverAtomMesh = pickedMesh;
      }

      // Clear previous highlights
      if (this._hoveredAtomMesh && this._hoveredAtomMesh !== hoverAtomMesh) {
        this._highlightHoveredAtom(this._hoveredAtomMesh, false);
      }
      
      // Update hover state
      this._hoveredAtomMesh = hoverAtomMesh;

      if (hoverAtomMesh) {
        // Hovering over other atom: hide drag atom, show bond connecting to target atom
        if (this._dragAtomMesh) {
          this._dragAtomMesh.isVisible = false;
        }
        this._updatePreviewBond([
          this._startAtomMesh.position,
          hoverAtomMesh.position,
        ]);
        
        // Highlight the hovered atom
        this._highlightHoveredAtom(hoverAtomMesh, true);
      } else {
        // Dragging to empty area: show drag atom and bond
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
      bmat.alpha = 0.6;
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
      // Get corresponding atom object from startAtomMesh
      const startAtomName = this._startAtomMesh.name.substring(5);
      const startAtom = this.system.current_frame.atoms.find((a) => a.name === startAtomName);
      
      if (!startAtom) {
        // If start atom not found, clean up state and return
        this._clearDragState();
        return;
      }

      let targetAtom: Atom | null = null;
      
      // Use currently hovered atom or re-detect
      if (this._hoveredAtomMesh) {
        const name = this._hoveredAtomMesh.name.substring(5);
        const atom = this.system.current_frame.atoms.find(
          (a) => a.name === name,
        );
        if (atom && atom !== startAtom) {
          targetAtom = atom;
        }
      } else {
        // If no hovered atom, re-check if there's an atom under mouse position
        const mesh = this.pick_mesh();
        if (mesh?.name.startsWith("atom:")) {
          const name = mesh.name.substring(5);
          const atom = this.system.current_frame.atoms.find(
            (a) => a.name === name,
          );
          if (atom && atom !== startAtom) {
            targetAtom = atom;
          }
        }
      }
      
      if (targetAtom) {
        // Connect to existing atom
        const bond = this.system.current_frame.add_bond(
          startAtom,
          targetAtom,
          { order: this.bondOrder },
        );
        draw_bond(this.app, bond, { order: this.bondOrder });
      } else if (this._dragAtomMesh) {
        // Create new atom and connect
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
        draw_bond(this.app, bond, { order: this.bondOrder });
      }

      this._clearDragState();
    } else if (!this._startAtomMesh && !this._is_dragging) {
      // Click on empty area: directly create atom
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
    
    // Call parent method to handle basic left-click logic
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

    // Clear hover state
    if (this._hoveredAtomMesh) {
      this._highlightHoveredAtom(this._hoveredAtomMesh, false);
      this._hoveredAtomMesh = null;
    }

    this.world.camera.attachControl(
      this.world.scene.getEngine().getRenderingCanvas(),
      false,
    );

    this._startAtomMesh = null;
  }

  protected override _on_right_up(pointerInfo: PointerInfo): void {
    // Only handle right-click when not dragging
    if (!this._is_dragging) {
      const mesh = this.pick_mesh();
      
      // If clicking on atom or bond, perform delete operation
      if (mesh?.name.startsWith("atom:")) {
        this.deleteAtom(mesh);
        // If menu is open, close it
        if (this.isContextMenuOpen()) {
          this.hideContextMenu();
          this.setContextMenuState(false);
        }
        return; // Don't call parent method, prevent menu display
      }
      if (mesh?.name.startsWith("bond:")) {
        this.deleteBond(mesh);
        // If menu is open, close it
        if (this.isContextMenuOpen()) {
          this.hideContextMenu();
          this.setContextMenuState(false);
        }
        return; // Don't call parent method, prevent menu display
      }
    }
    
    // If not clicking on atom or bond, call parent method to handle menu toggle logic
    super._on_right_up(pointerInfo);
  }

  private deleteAtom(mesh: AbstractMesh): void {
    const atomName = mesh.name.substring(5);
    const atom = this.system.current_frame.atoms.find((a) => a.name === atomName);
    if (atom) {
      // Delete all bonds related to this atom
      const relatedBonds = this.system.current_frame.bonds.filter(
        (bond) => bond.itom === atom || bond.jtom === atom
      );
      
      // Delete bond meshes
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
      
      // Remove atom from system (will automatically delete related bonds)
      this.system.current_frame.remove_atom(atom);
      
      // Delete atom mesh
      mesh.dispose();
    }
  }

  private deleteBond(mesh: AbstractMesh): void {
    const bondName = mesh.name.split(":")[1]; // Extract bond name
    const bond = this.system.current_frame.bonds.find((b) => b.name === bondName);
    if (bond) {
      // Delete all related bond meshes
      for (let i = 0; ; i++) {
        const bondMesh = this.world.scene.getMeshByName(`bond:${bondName}:${i}`);
        if (bondMesh) {
          bondMesh.dispose();
        } else {
          break;
        }
      }
      
      // TODO: Frame class needs to add remove_bond method
    }
  }

  public override finish(): void {
    // Clean up drag state
    this._clearDragState();
    
    // Clean up menu
    if (this.menu) {
      this.menu.dispose();
    }
    
    // Call parent finish method
    super.finish();
  }

  private _highlightHoveredAtom(mesh: AbstractMesh, highlight: boolean): void {
    const material = mesh.material as StandardMaterial;
    if (material) {
      if (highlight) {
        // Set highlight effect - use emissive and specular lighting
        material.emissiveColor = new Color3(0.3, 0.3, 0.1); // Emissive effect
        material.specularColor = new Color3(1, 1, 1); // Specular effect
      } else {
        // Restore original appearance
        material.emissiveColor = new Color3(0, 0, 0);
        material.specularColor = new Color3(0.2, 0.2, 0.2);
      }
    }
  }

}

export { EditMode };
