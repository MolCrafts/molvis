import {
  type AbstractMesh,
  type PointerInfo,
  Quaternion,
  Vector3,
} from "@babylonjs/core";
import type { MolvisApp as Molvis } from "../app";
import { buildSubBondInstanceBuffers } from "../artist/bond_buffer";
import { TransformGizmo } from "../gizmo/transform_gizmo";
import { ContextMenuController } from "../ui/menus/controller";
import { displayBondOrder } from "../utils/bond_order";
import { BaseMode, ModeType } from "./base";
import { CommonMenuItems } from "./menu_items";
import {
  eulerDegreesToQuaternion,
  quaternionToEulerDegrees,
  rotateAroundPivot,
  selectionCentroid,
  type Vec3,
} from "./selection_transform";
import type { MenuItem, SceneHit } from "./types";

/** Blender-style tool: G = grab/move, R = rotate. */
export type ManipulateTool = "move" | "rotate";

/** Shared identity for pose resets — never mutated (setPose copies from it). */
const IDENTITY_QUATERNION = Quaternion.Identity();

/** Smallest useful gizmo diameter (Å) — a lone atom still gets a handle. */
const GIZMO_MIN_DIAMETER = 1.5;

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
      CommonMenuItems.button("Move (G)", () => {
        this.mode.setTool("move");
      }),
      CommonMenuItems.button("Rotate (R)", () => {
        this.mode.setTool("rotate");
      }),
      CommonMenuItems.separator(),
      CommonMenuItems.button("Clear Select", () => {
        this.mode.clearSelection();
      }),
      CommonMenuItems.separator(),
    );
    return CommonMenuItems.appendCommonTail(items, this.app);
  }
}

/**
 * ManipulateMode — transform the live selection (atoms).
 *
 * Selection is **preserved** on enter/leave so Select → Manipulate keeps
 * the highlight. Canvas picks still update selection; Esc / Clear / empty
 * click clears it.
 *
 * Transform UX follows Blender's grabber:
 * - **G** / move gizmo — translate selection as a rigid body
 * - **R** / rotation rings — Euler-axis rings around the selection centroid
 * - Panel Euler XYZ (degrees) sets absolute rotation from the last rest pose
 */
class ManipulateMode extends BaseMode {
  // Free drag on screen plane (whole selection when multi-selected)
  private isDragging = false;
  private dragPlaneAnchor: Vector3 | null = null;
  private freeDragAtomIds: number[] = [];
  private freeDragRest = new Map<number, Vec3>();
  /** Selection centroid at free-drag start — the gizmo follows it + delta. */
  private freeDragCentroid: Vec3 | null = null;

  private tool: ManipulateTool = "rotate";
  private gizmo: TransformGizmo | null = null;
  private unsubSelection: (() => void) | null = null;

  /** Snapshot of atom positions at gizmo drag start (or Euler rest). */
  private restPositions = new Map<number, Vec3>();
  /** Pivot world position at rest (centroid). */
  private restPivot: Vec3 | null = null;
  /** Accumulated orientation applied on top of rest positions. */
  private restQuaternion = Quaternion.Identity();
  private applyingGizmo = false;
  private gizmoDragActive = false;

  constructor(app: Molvis) {
    super(ModeType.Manipulate, app);
  }

  public override start(): void {
    super.start();
    // Frame-loaded atoms must be in the edit pool to accept buffer updates.
    this.app.world.sceneIndex.promoteFrameToEditPool();
    // Do NOT clear selection — Select mode hands off the live set.

    this.ensureGizmo();
    this.captureRestFromSelection();
    this.syncGizmoToSelection();

    this.unsubSelection = this.app.world.selectionManager.on(
      "selection-change",
      () => {
        if (this.gizmoDragActive || this.applyingGizmo) return;
        this.captureRestFromSelection();
        this.syncGizmoToSelection();
        this.emitStatus();
      },
    );
    this.emitStatus();
  }

  protected createContextMenuController(): ContextMenuController {
    return new ManipulateModeContextMenu(this.app, this);
  }

  // ── Public API (panel / RPC-friendly) ───────────────────────────

  public getTool(): ManipulateTool {
    return this.tool;
  }

  public setTool(tool: ManipulateTool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.gizmo?.setTool(tool);
    this.emitStatus();
  }

  /** Selection centroid in world space, or null when empty. */
  public getCentroid(): Vec3 | null {
    return this.restPivot ? { ...this.restPivot } : null;
  }

  /**
   * Current Euler XYZ degrees of the selection orientation relative to the
   * rest pose captured when the selection last changed.
   */
  public getEulerDegrees(): Vec3 {
    return quaternionToEulerDegrees(this.restQuaternion);
  }

  /**
   * Set absolute Euler XYZ (degrees) for the selection relative to rest.
   * Replaces the gizmo orientation and rewrites atom positions from rest.
   */
  public setEulerDegrees(x: number, y: number, z: number): void {
    if (!this.restPivot || this.restPositions.size === 0) return;
    const q = eulerDegreesToQuaternion(x, y, z);
    this.restQuaternion = q;
    this.applyRestTransform(q, this.restPivot);
    // applyRestTransform already flushes GPU; mirror the pose on the gizmo.
    this.gizmo?.setPose(this.restPivot, q);
    this.emitStatus();
  }

  public clearSelection(): void {
    this.app.world.selectionManager.apply({ type: "clear" });
    this.app.events.emit("info-text-change", "");
  }

  // ── Selection helpers ───────────────────────────────────────────

  private selectedAtomIds(): number[] {
    const ids = new Set(this.app.world.selectionManager.getSelectedAtomIds());
    // Bonds alone still imply their endpoints (fence/select bond workflow).
    for (const bondId of this.app.world.selectionManager.getSelectedBondIds()) {
      const ends = this.world.sceneIndex.topology.endpoints(bondId);
      if (ends) {
        ids.add(ends[0]);
        ids.add(ends[1]);
      }
    }
    return [...ids];
  }

  private captureRestFromSelection(): void {
    this.restPositions.clear();
    this.restQuaternion = Quaternion.Identity();
    const atoms = this.selectedAtomIds();
    const positions: Vec3[] = [];
    for (const atomId of atoms) {
      // Prefer live GPU buffer (canvas WYSIWYG); fall back to meta.
      const p = this.readAtomPosition(atomId);
      if (!p) continue;
      this.restPositions.set(atomId, p);
      positions.push(p);
    }
    this.restPivot = selectionCentroid(positions);
  }

  /**
   * Live atom centre from the impostor instance buffer, else meta.position.
   * Buffer is what is on canvas — avoids gizmo parking at a stale/zero meta.
   */
  private readAtomPosition(atomId: number): Vec3 | null {
    const atomState = this.world.sceneIndex.meshRegistry.getAtomState();
    if (atomState) {
      const indices = atomState.renderIndicesForLogicalId(atomId);
      const idx = indices[0];
      if (idx !== undefined) {
        const buf = atomState.buffers.get("instanceData");
        if (buf) {
          const base = idx * buf.stride;
          const x = buf.data[base];
          const y = buf.data[base + 1];
          const z = buf.data[base + 2];
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            return { x, y, z };
          }
        }
      }
    }
    const meta = this.findAtomMeta(atomId);
    if (!meta) return null;
    return {
      x: meta.position.x,
      y: meta.position.y,
      z: meta.position.z,
    };
  }

  private emitStatus(): void {
    const n = this.restPositions.size;
    if (n === 0) {
      this.app.events.emit(
        "info-text-change",
        "Manipulate: select atoms (Select mode or click), G move · R rotate",
      );
      return;
    }
    const e = this.getEulerDegrees();
    this.app.events.emit(
      "info-text-change",
      `${n} atom${n === 1 ? "" : "s"} · ${this.tool === "move" ? "Move (G)" : "Rotate (R)"} · Euler ${e.x.toFixed(1)}° ${e.y.toFixed(1)}° ${e.z.toFixed(1)}°`,
    );
  }

  // ── Gizmo lifecycle ─────────────────────────────────────────────

  private ensureGizmo(): void {
    if (this.gizmo) return;
    // World-axis-locked move/rotate pair; binding, pivot and utility layer
    // all live in TransformGizmo — this mode only feeds it selection state.
    this.gizmo = new TransformGizmo(this.scene, {
      onDragStart: () => this.onGizmoDragStart(),
      onDrag: () => this.onGizmoDrag(),
      onDragEnd: () => this.onGizmoDragEnd(),
    });
    this.gizmo.setTool(this.tool);
  }

  private syncGizmoToSelection(): void {
    if (!this.gizmo) return;
    if (!this.restPivot || this.restPositions.size === 0) {
      this.gizmo.hide();
      return;
    }
    // show() parks the pivot at the centroid with identity rotation, so the
    // Euler panel restarts from the rest pose.
    this.restQuaternion = Quaternion.Identity();
    this.gizmo.show(this.restPivot, this.gizmoDiameter());
  }

  /**
   * World-space gizmo diameter: about half the selection span (never
   * wrapping it), floored so a single atom still gets a graspable handle.
   * World-anchored so zooming the camera scales the gizmo with the
   * molecule.
   */
  private gizmoDiameter(): number {
    const pivot = this.restPivot;
    if (!pivot) return GIZMO_MIN_DIAMETER;
    let maxR = 0;
    for (const p of this.restPositions.values()) {
      maxR = Math.max(
        maxR,
        Math.hypot(p.x - pivot.x, p.y - pivot.y, p.z - pivot.z),
      );
    }
    return Math.max(maxR, GIZMO_MIN_DIAMETER);
  }

  private onGizmoDragStart(): void {
    this.gizmoDragActive = true;
    // Snapshot atom positions at drag start; zero the pivot orientation so
    // the rotation gizmo reports a pure delta from this gesture.
    this.captureRestFromSelection();
    if (this.restPivot) {
      this.gizmo?.setPose(this.restPivot, Quaternion.Identity());
    }
    this.world.camera.detachControl();
  }

  private onGizmoDrag(): void {
    const gizmo = this.gizmo;
    if (!this.gizmoDragActive || !gizmo || !this.restPivot) return;
    if (this.restPositions.size === 0) return;
    this.applyingGizmo = true;

    if (this.tool === "move") {
      const pos = gizmo.pivotPosition;
      const delta = {
        x: pos.x - this.restPivot.x,
        y: pos.y - this.restPivot.y,
        z: pos.z - this.restPivot.z,
      };
      for (const [atomId, rest] of this.restPositions) {
        this.writeAtomPosition(
          atomId,
          rest.x + delta.x,
          rest.y + delta.y,
          rest.z + delta.z,
        );
      }
    } else {
      const q = gizmo.pivotRotation.clone();
      this.restQuaternion = q;
      for (const [atomId, rest] of this.restPositions) {
        const next = rotateAroundPivot(rest, this.restPivot, q);
        this.writeAtomPosition(atomId, next.x, next.y, next.z);
      }
    }

    this.refreshBondsAround(this.restPositions.keys());
    // CPU buffers are dirty — must upload or the canvas never moves.
    this.flushVisuals();
    this.applyingGizmo = false;
  }

  private onGizmoDragEnd(): void {
    this.gizmoDragActive = false;
    // Bake current world positions as the new rest so Euler panel restarts at 0.
    this.captureRestFromSelection();
    this.restQuaternion = Quaternion.Identity();
    if (this.restPivot) {
      this.gizmo?.setPose(this.restPivot, Quaternion.Identity());
    } else {
      this.gizmo?.hide();
    }
    this.world.camera.attachControl(
      this.world.scene.getEngine().getRenderingCanvas(),
      false,
    );
    this.emitStatus();
  }

  private applyRestTransform(q: Quaternion, pivot: Vec3): void {
    for (const [atomId, rest] of this.restPositions) {
      const next = rotateAroundPivot(rest, pivot, q);
      this.writeAtomPosition(atomId, next.x, next.y, next.z);
    }
    this.refreshBondsAround(this.restPositions.keys());
    this.flushVisuals();
  }

  /**
   * Push dirty impostor buffers to the GPU. SceneIndex.update* only mutates
   * CPU arrays + dirty flags — without this call the canvas never moves
   * (gizmo/Euler/free-drag all go through here).
   *
   * Bond updates may mark color buffers dirty; re-apply selection highlight
   * so drag never looks like a deselect.
   */
  private flushVisuals(): void {
    this.app.artist.applySceneIndexToMeshes();
    this.world.sceneIndex.markAllUnsaved();
    this.app.world.highlighter.invalidateAndRebuild();
  }

  private disposeGizmo(): void {
    this.gizmo?.dispose();
    this.gizmo = null;
  }

  // ── Atom / bond geometry updates ────────────────────────────────

  private selectAtom(mesh: AbstractMesh, thinIndex: number): void {
    const meta = this.world.sceneIndex.getMeta(mesh.uniqueId, thinIndex);
    if (meta?.type !== "atom") return;
    this.app.world.selectionManager.apply({
      type: "replace",
      atoms: [meta.atomId],
    });
  }

  private selectBond(mesh: AbstractMesh, thinIndex: number): void {
    const meta = this.world.sceneIndex.getMeta(mesh.uniqueId, thinIndex);
    if (meta?.type !== "bond") return;
    this.app.world.selectionManager.apply({
      type: "replace",
      bonds: [meta.bondId],
    });
  }

  /**
   * Write one atom's **position only** into CPU impostor buffers + meta.
   * Preserves existing matrix scale and instance radius so drag never
   * resizes atoms. Does **not** touch bonds and does **not** GPU-upload —
   * callers batch atoms, then {@link refreshBondsAround} once (each shared
   * bond rebuilt exactly once), then {@link flushVisuals} once.
   */
  private writeAtomPosition(
    atomId: number,
    x: number,
    y: number,
    z: number,
  ): void {
    const atomState = this.world.sceneIndex.meshRegistry.getAtomState();
    if (!atomState) return;
    const meshId = atomState.mesh.uniqueId;

    const indices = atomState.renderIndicesForLogicalId(atomId);
    const idx = indices[0];
    if (idx === undefined) return;

    const matDesc = atomState.buffers.get("matrix");
    const dataDesc = atomState.buffers.get("instanceData");
    if (!matDesc || !dataDesc) return;

    // Preserve scale (matrix[0,5,10]) and radius (instanceData[3]) — only
    // rewrite translation / xyz. Recomputing from style.radius * 0.6 was
    // shrinking every atom on the first drag and could not be undone.
    const m = idx * matDesc.stride;
    matDesc.data[m + 12] = x;
    matDesc.data[m + 13] = y;
    matDesc.data[m + 14] = z;

    const d = idx * dataDesc.stride;
    dataDesc.data[d] = x;
    dataDesc.data[d + 1] = y;
    dataDesc.data[d + 2] = z;

    atomState.markDirty("matrix", "instanceData");

    // Meta only — do not pass buffer maps (that path markAllDirties and
    // would re-upload colors, wiping selection highlight).
    this.world.sceneIndex.updateAtom(meshId, atomId, {
      position: { x, y, z },
    });
  }

  /**
   * Rebuild instance buffers for every bond incident to `atomIds`, each bond
   * exactly once — a bond between two moved atoms is no longer rebuilt per
   * endpoint. Endpoint positions come from atom meta, which
   * {@link writeAtomPosition} has already updated, so this must run after
   * all atom writes of the current gesture tick.
   */
  private refreshBondsAround(atomIds: Iterable<number>): void {
    const bondIds = new Set<number>();
    for (const atomId of atomIds) {
      for (const bondId of this.world.sceneIndex.topology.incident(atomId)) {
        bondIds.add(bondId);
      }
    }
    for (const bondId of bondIds) {
      this.refreshBond(bondId);
    }
  }

  /** Rebuild one bond's instance buffers from its endpoints' current meta. */
  private refreshBond(bondId: number): void {
    const bondState = this.world.sceneIndex.meshRegistry.getBondState();
    if (!bondState) return;

    const endpoints = this.world.sceneIndex.topology.endpoints(bondId);
    if (!endpoints) return;
    const [atom1, atom2] = endpoints;
    const meta1 = this.findAtomMeta(atom1);
    const meta2 = this.findAtomMeta(atom2);
    if (!meta1 || !meta2) return;

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

    this.world.sceneIndex.updateBond(
      bondState.mesh.uniqueId,
      bondId,
      {
        start: { x: p1.x, y: p1.y, z: p1.z },
        end: { x: p2.x, y: p2.y, z: p2.z },
      },
      updates,
    );
  }

  private findAtomMeta(atomId: number) {
    return this.world.sceneIndex.metaRegistry.atoms.getMeta(atomId);
  }

  private findBondMeta(bondId: number) {
    return this.world.sceneIndex.metaRegistry.bonds.getMeta(bondId);
  }

  // ── Pointer / keyboard ──────────────────────────────────────────

  override async _on_pointer_down(pointerInfo: PointerInfo): Promise<void> {
    super._on_pointer_down(pointerInfo);

    if (pointerInfo.event.button !== 0) return;

    // Let gizmo utility-layer handles consume their own picks.
    if (this.gizmo?.isPointerActive) {
      return;
    }

    const hit = await this.pickHit();
    if (hit && hit.type === "atom" && hit.mesh) {
      const thinIndex = hit.thinInstanceIndex ?? -1;
      const meta = this.world.sceneIndex.getMeta(hit.mesh.uniqueId, thinIndex);
      if (meta?.type !== "atom") return;

      // Keep multi-selection when clicking an already-selected atom (Blender).
      const alreadySelected = this.app.world.selectionManager
        .getSelectedAtomIds()
        .has(meta.atomId);
      if (!alreadySelected) {
        this.selectAtom(hit.mesh, thinIndex);
      }

      // Free drag: whole current selection as a rigid body on the screen plane.
      this.freeDragAtomIds = this.selectedAtomIds();
      this.freeDragRest.clear();
      for (const atomId of this.freeDragAtomIds) {
        const p = this.readAtomPosition(atomId);
        if (!p) continue;
        this.freeDragRest.set(atomId, p);
      }
      this.freeDragCentroid = selectionCentroid([
        ...this.freeDragRest.values(),
      ]);
      const anchor = this.readAtomPosition(meta.atomId) ?? {
        x: meta.position.x,
        y: meta.position.y,
        z: meta.position.z,
      };
      this.dragPlaneAnchor = new Vector3(anchor.x, anchor.y, anchor.z);
      this.world.camera.detachControl();
      return;
    }

    if (hit && hit.type === "bond" && hit.mesh) {
      this.selectBond(hit.mesh, hit.thinInstanceIndex ?? -1);
      return;
    }

    this.clearSelection();
  }

  override async _on_pointer_move(pointerInfo: PointerInfo): Promise<void> {
    if (this.gizmoDragActive) return;

    if (!this.dragPlaneAnchor || this.freeDragRest.size === 0) {
      await super._on_pointer_move(pointerInfo);
      return;
    }

    this.isDragging = true;

    const pointer = this.projectPointerOnScreenPlane(this.dragPlaneAnchor);
    if (!pointer) return;

    const delta = {
      x: pointer.x - this.dragPlaneAnchor.x,
      y: pointer.y - this.dragPlaneAnchor.y,
      z: pointer.z - this.dragPlaneAnchor.z,
    };

    for (const [atomId, rest] of this.freeDragRest) {
      this.writeAtomPosition(
        atomId,
        rest.x + delta.x,
        rest.y + delta.y,
        rest.z + delta.z,
      );
    }
    this.refreshBondsAround(this.freeDragRest.keys());
    this.flushVisuals();

    // Keep the gizmo riding on the selection instead of parking at the
    // drag-start centroid and snapping over on release.
    if (this.freeDragCentroid) {
      this.gizmo?.setPose(
        {
          x: this.freeDragCentroid.x + delta.x,
          y: this.freeDragCentroid.y + delta.y,
          z: this.freeDragCentroid.z + delta.z,
        },
        IDENTITY_QUATERNION,
      );
    }

    const n = this.freeDragRest.size;
    this.app.events.emit(
      "info-text-change",
      `Moving ${n} atom${n === 1 ? "" : "s"} · Δ (${delta.x.toFixed(2)}, ${delta.y.toFixed(2)}, ${delta.z.toFixed(2)})`,
    );
  }

  override async _on_pointer_up(pointerInfo: PointerInfo): Promise<void> {
    await super._on_pointer_up(pointerInfo);

    if (pointerInfo.event.button !== 0) return;

    if (this.isDragging && this.freeDragRest.size > 0) {
      // Keep selection after free-drag so the gizmo stays on the group.
      this.captureRestFromSelection();
      this.syncGizmoToSelection();
      this.emitStatus();
    }

    this.world.camera.attachControl(
      this.world.scene.getEngine().getRenderingCanvas(),
      false,
    );
    this.isDragging = false;
    this.dragPlaneAnchor = null;
    this.freeDragAtomIds = [];
    this.freeDragRest.clear();
    this.freeDragCentroid = null;
  }

  public hasUnsavedChanges(): boolean {
    return this.app.world.sceneIndex.hasUnsavedChanges;
  }

  protected override _on_press_escape(): void {
    this.clearSelection();
  }

  /** Blender grab — enable translate gizmo. */
  protected override _on_press_g(): void {
    this.setTool("move");
  }

  /** Blender rotate — enable rotation rings. */
  protected override _on_press_r(): void {
    this.setTool("rotate");
  }

  public override finish(): void {
    this.unsubSelection?.();
    this.unsubSelection = null;
    this.disposeGizmo();
    this.restPositions.clear();
    this.restPivot = null;
    // Preserve live selection across mode switches — do not clear.
    super.finish();
  }
}

export { ManipulateMode };
