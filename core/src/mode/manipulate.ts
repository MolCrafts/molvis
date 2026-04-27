import { type AbstractMesh, type PointerInfo, Vector3 } from "@babylonjs/core";
import { type Block, Frame } from "@molcrafts/molrs";
import type { MolvisApp as Molvis } from "../app";
import { buildSubBondInstanceBuffers } from "../artist/bond_buffer";
import { syncSceneToFrame } from "../scene_sync";
import { ContextMenuController } from "../ui/menus/controller";
import { logger } from "../utils/logger";
import { BaseMode, ModeType } from "./base";
import { CommonMenuItems } from "./menu_items";
import type { HitResult, MenuItem } from "./types";

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
    _hit: HitResult | null,
    isDragging: boolean,
  ): boolean {
    return !isDragging;
  }

  protected buildMenuItems(_hit: HitResult | null): MenuItem[] {
    const items: MenuItem[] = [];

    if (this.mode.hasUnsavedChanges()) {
      items.push(
        {
          type: "button",
          title: "Save Changes",
          action: () => {
            this.mode.saveChanges();
          },
        },
        {
          type: "button",
          title: "Discard Changes",
          action: () => {
            this.mode.discardChanges();
          },
        },
        { type: "separator" },
      );
    }

    items.push(
      {
        type: "button",
        title: "Clear Selection",
        action: () => {
          this.mode.clearSelection();
        },
      },
      { type: "separator" },
      {
        type: "button",
        title: "Reset Positions",
        action: () => {
          this.app.events.emit("info-text-change", "Reset not implemented yet");
        },
      },
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

  // Frame conversion state
  private originalFrameData: {
    atomBlock: Block;
    bondBlock?: Block;
  } | null = null;

  constructor(app: Molvis) {
    super(ModeType.Manipulate, app);
  }

  public override start(): void {
    super.start();
    this.app.world.selectionManager.apply({ type: "clear" });
    this.convertFromSceneIndex();
  }

  private convertFromSceneIndex(): void {
    const atomBlock = this.world.sceneIndex.metaRegistry.atoms.frameBlock;
    if (!atomBlock) return;

    this.originalFrameData = {
      atomBlock: atomBlock,
      bondBlock:
        this.world.sceneIndex.metaRegistry.bonds.frameBlock || undefined,
    };
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
    const order = meta && meta.type === "bond" ? meta.order : 1;
    this.app.events.emit("info-text-change", `Selected bond (order: ${order})`);
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
      const order = bondMeta?.order ?? 1;
      const bondRadius = bondMeta
        ? this.app.styleManager.getBondStyle(order).radius
        : 0.1;

      // Reuse the same sub-instance layout the edit path used when creating
      // the bond so multi-order bonds stay properly offset under manipulation.
      const placeholderColor = new Float32Array(4);
      const { buffers: subBuffers } = buildSubBondInstanceBuffers(
        p1,
        p2,
        order,
        bondRadius,
        placeholderColor,
        placeholderColor,
        0,
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
    // Check if there are edits
    return this.world.sceneIndex.metaRegistry.atoms.edits.size > 0;
  }

  public async saveChanges(): Promise<void> {
    if (!this.hasUnsavedChanges()) return;

    const frame = this.app.system.frame;
    if (!frame) {
      logger.warn("[ManipulateMode] No system frame to save to");
      return;
    }

    syncSceneToFrame(this.world.sceneIndex, frame);

    void this.app.applyPipeline({ changeKind: "full", sourceFrame: frame });

    this.originalFrameData = null;
    logger.info("[ManipulateMode] Saved changes using syncSceneToFrame");
  }

  protected override _on_press_ctrl_s(): void {
    this.app.save();
  }

  public async discardChanges(): Promise<void> {
    if (!this.originalFrameData) return;

    const frame = new Frame();
    frame.insertBlock("atoms", this.originalFrameData.atomBlock);
    if (this.originalFrameData.bondBlock) {
      frame.insertBlock("bonds", this.originalFrameData.bondBlock);
    }

    void this.app.applyPipeline({ changeKind: "full", sourceFrame: frame });

    this.originalFrameData = null;
    logger.info(
      "[ManipulateMode] Discarded changes and restored original frame",
    );
  }

  protected override _on_press_escape(): void {
    this.clearSelection();
  }

  public override finish(): void {
    this.clearSelection();
    this.restoreSceneFromFrame();
    this.originalFrameData = null;
    super.finish();
  }
}

export { ManipulateMode };
