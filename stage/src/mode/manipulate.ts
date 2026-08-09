import { type AbstractMesh, type PointerInfo, Vector3 } from "@babylonjs/core";
import type { MolvisApp as Molvis } from "../app";
import { buildSubBondInstanceBuffers } from "../artist/bond_buffer";
import { ContextMenuController } from "../ui/menus/controller";
import { displayBondOrder, formatBondLabel } from "../utils/bond_order";
import { BaseMode, ModeType } from "./base";
import { CommonMenuItems } from "./menu_items";
import type { MenuItem, SceneHit } from "./types";

/**
 * =============================
 * Manipulate Mode
 * =============================
 */

class ManipulateModeContextMenu extends ContextMenuController {
  constructor(
    app: Molvis,
    private mode: ManipulateMode,
  ) {
    super(app, "molvis-manipulate-menu");
  }

  protected shouldShowMenu(
    _hit: SceneHit | null,
    isDragging: boolean,
  ): boolean {
    return !isDragging;
  }

  protected buildMenuItems(hit: SceneHit | null): MenuItem[] {
    const items: MenuItem[] = [];
    const header = hit ? CommonMenuItems.hitLabel(hit) : null;
    if (header) {
      items.push(header);
      items.push(CommonMenuItems.separator());
    }

    if (this.app.world.sceneIndex.hasUnsavedChanges) {
      items.push(
        CommonMenuItems.button("Save", () => {
          void this.app.commitScene();
        }),
        CommonMenuItems.button("Discard", () => {
          this.app.discardScene();
        }),
        CommonMenuItems.separator(),
      );
    }

    items.push(
      CommonMenuItems.button("Clear Select", () => {
        this.mode.clearSelection();
      }),
      CommonMenuItems.separator(),
    );
    return CommonMenuItems.appendCommonTail(items, this.app);
  }
}

/**
 * ManipulateMode - for moving atoms and adjusting geometry
 */
class ManipulateMode extends BaseMode {
  // Drag state
  private isDragging = false;
  private dragStartPosition: Vector3 | null = null;
  private draggedAtomId = -1;

  constructor(app: Molvis) {
    super(ModeType.Manipulate, app);
  }

  public override start(): void {
    super.start();
    this.app.world.selectionManager.apply({ type: "clear" });
  }

  protected createContextMenuController(): ContextMenuController {
    return new ManipulateModeContextMenu(this.app, this);
  }

  public clearSelection(): void {
    this.app.world.selectionManager.apply({ type: "clear" });
    this.app.events.emit("info-text-change", "");
  }

  private selectAtom(mesh: AbstractMesh, thinIndex: number): void {
    this.clearSelection();
    const key = `${mesh.uniqueId}:${thinIndex}`;
    this.app.world.selectionManager.apply({ type: "replace", atoms: [key] });

    const meta = this.world.sceneIndex.getMeta(mesh.uniqueId, thinIndex);
    const element = meta && meta.type === "atom" ? meta.element : "?";
    const pos =
      meta && meta.type === "atom" ? meta.position : { x: 0, y: 0, z: 0 };
    this.app.events.emit(
      "info-text-change",
      `Selected: ${element} at (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`,
    );
  }

  private selectBond(mesh: AbstractMesh, thinIndex: number): void {
    this.clearSelection();
    const key = `${mesh.uniqueId}:${thinIndex}`;
    this.app.world.selectionManager.apply({ type: "replace", bonds: [key] });

    const meta = this.world.sceneIndex.getMeta(mesh.uniqueId, thinIndex);
    const label =
      meta && meta.type === "bond"
        ? formatBondLabel(meta.bondType, meta.bondNumber)
        : "single";
    this.app.events.emit("info-text-change", `Selected bond · ${label}`);
  }

  /**
   * Move an atom to a new position by updating its pool buffers and connected bonds.
   */
  private moveAtom(atomId: number, newPosition: Vector3): void {
    const atomState = this.world.sceneIndex.meshRegistry.getAtomState();
    if (!atomState) return;
    const meshId = atomState.mesh.uniqueId;

    const style = this.app.styleManager.getAtomStyle(
      this.findAtomMeta(atomId)?.element ?? "C",
    );
    const radius = style.radius * 0.6;
    const scale = radius * 2;

    // Update atom buffer: matrix + instanceData
    const matrix = new Float32Array(16);
    matrix[0] = scale;
    matrix[5] = scale;
    matrix[10] = scale;
    matrix[15] = 1;
    matrix[12] = newPosition.x;
    matrix[13] = newPosition.y;
    matrix[14] = newPosition.z;

    const updates = new Map<string, Float32Array>();
    updates.set("matrix", matrix);
    updates.set(
      "instanceData",
      new Float32Array([newPosition.x, newPosition.y, newPosition.z, radius]),
    );

    // Use SceneIndex to update BOTH metadata and pool
    this.world.sceneIndex.updateAtom(
      meshId,
      atomId,
      {
        position: { x: newPosition.x, y: newPosition.y, z: newPosition.z },
      },
      updates,
    );

    // Update connected bonds via topology
    this.updateConnectedBonds(atomId, newPosition);

    this.world.sceneIndex.markAllUnsaved();
  }

  /**
   * Update bond buffers connected to a moved atom.
   */
  private updateConnectedBonds(atomId: number, newPosition: Vector3): void {
    const bondState = this.world.sceneIndex.meshRegistry.getBondState();
    if (!bondState) return;
    const meshId = bondState.mesh.uniqueId;

    const bondIds = this.world.sceneIndex.topology.incident(atomId);

    for (const bondId of bondIds) {
      const endpoints = this.world.sceneIndex.topology.endpoints(bondId);
      if (!endpoints) continue;

      // Resolve endpoint positions via MetaRegistry
      const atom1 = endpoints[0];
      const atom2 = endpoints[1];

      const meta1 =
        atom1 === atomId ? { position: newPosition } : this.findAtomMeta(atom1);
      const meta2 =
        atom2 === atomId ? { position: newPosition } : this.findAtomMeta(atom2);

      if (!meta1 || !meta2) continue;

      const p1 = new Vector3(
        meta1.position.x,
        meta1.position.y,
        meta1.position.z,
      );
      const p2 = new Vector3(
        meta2.position.x,
        meta2.position.y,
        meta2.position.z,
      );

      const bondMeta = this.findBondMeta(bondId);
      const sticks = bondMeta
        ? displayBondOrder(bondMeta.bondType, bondMeta.bondNumber)
        : 1;
      const bondRadius = bondMeta
        ? this.app.styleManager.getBondStyle(sticks).radius
        : 0.1;

      // Reuse the same sub-instance layout the edit path used when creating
      // the bond so multi-order bonds stay properly offset under manipulation.
      const offsetAxis = new Vector3();
      this.world.sceneIndex.bondPlaneAxis(
        atom1,
        p1,
        atom2,
        p2,
        p2.subtract(p1).normalize(),
        offsetAxis,
      );

      const placeholderColor = new Float32Array(4);
      const { buffers: subBuffers } = buildSubBondInstanceBuffers(
        p1,
        p2,
        sticks,
        bondRadius,
        placeholderColor,
        placeholderColor,
        0,
        offsetAxis,
      );

      const updates = new Map<string, Float32Array>();
      const matrix = subBuffers.get("matrix");
      const data0 = subBuffers.get("instanceData0");
      const data1 = subBuffers.get("instanceData1");
      if (matrix) updates.set("matrix", matrix);
      if (data0) updates.set("instanceData0", data0);
      if (data1) updates.set("instanceData1", data1);

      // Update bond using SceneIndex
      this.world.sceneIndex.updateBond(
        meshId,
        bondId,
        {
          start: { x: p1.x, y: p1.y, z: p1.z },
          end: { x: p2.x, y: p2.y, z: p2.z },
        },
        updates,
      );
    }
  }

  private findAtomMeta(atomId: number) {
    return this.world.sceneIndex.metaRegistry.atoms.getMeta(atomId);
  }

  private findBondMeta(bondId: number) {
    return this.world.sceneIndex.metaRegistry.bonds.getMeta(bondId);
  }

  // --------------------------------
  // Pointer Event Handlers
  // --------------------------------

  override async _on_pointer_down(pointerInfo: PointerInfo): Promise<void> {
    super._on_pointer_down(pointerInfo);

    if (pointerInfo.event.button !== 0) return;

    const hit = await this.pickHit();
    if (hit && hit.type === "atom" && hit.mesh) {
      const thinIndex = hit.thinInstanceIndex ?? -1;
      this.selectAtom(hit.mesh, thinIndex);

      // Resolve atom ID for dragging
      const meta = this.world.sceneIndex.getMeta(hit.mesh.uniqueId, thinIndex);
      if (meta && meta.type === "atom") {
        this.draggedAtomId = meta.atomId;
        this.dragStartPosition = new Vector3(
          meta.position.x,
          meta.position.y,
          meta.position.z,
        );
        this.world.camera.detachControl();
      }
      return;
    }

    if (hit && hit.type === "bond" && hit.mesh) {
      this.selectBond(hit.mesh, hit.thinInstanceIndex ?? -1);
      return;
    }

    this.clearSelection();
  }

  override async _on_pointer_move(pointerInfo: PointerInfo): Promise<void> {
    if (this.draggedAtomId === -1 || !this.dragStartPosition) {
      await super._on_pointer_move(pointerInfo);
      return;
    }

    this.isDragging = true;

    const newPosition = this.projectPointerOnScreenPlane(
      this.dragStartPosition,
    );
    if (!newPosition) return;

    this.moveAtom(this.draggedAtomId, newPosition);

    const meta = this.findAtomMeta(this.draggedAtomId);
    const element = meta?.element ?? "?";
    this.app.events.emit(
      "info-text-change",
      `Moving ${element}: (${newPosition.x.toFixed(2)}, ${newPosition.y.toFixed(2)}, ${newPosition.z.toFixed(2)})`,
    );
  }

  override async _on_pointer_up(pointerInfo: PointerInfo): Promise<void> {
    await super._on_pointer_up(pointerInfo);

    if (pointerInfo.event.button !== 0) return;

    if (this.draggedAtomId !== -1 && this.isDragging) {
      const meta = this.findAtomMeta(this.draggedAtomId);
      const element = meta?.element ?? "?";
      const pos = meta?.position ?? { x: 0, y: 0, z: 0 };
      this.app.events.emit(
        "info-text-change",
        `Moved ${element} to (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`,
      );
      this.clearSelection();
    }

    this.world.camera.attachControl(
      this.world.scene.getEngine().getRenderingCanvas(),
      false,
    );
    this.isDragging = false;
    this.draggedAtomId = -1;
    this.dragStartPosition = null;
  }

  // --------------------------------
  // Frame Conversion Methods
  // --------------------------------

  public hasUnsavedChanges(): boolean {
    return this.app.world.sceneIndex.hasUnsavedChanges;
  }

  // Ctrl+S → BaseMode._on_press_ctrl_s (global commitScene)

  protected override _on_press_escape(): void {
    this.clearSelection();
  }

  public override finish(): void {
    this.clearSelection();
    // Park working tree — do not discard uncommitted edits on mode leave.
    super.finish();
  }
}

export { ManipulateMode };
