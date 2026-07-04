import { Matrix, type PointerInfo, Vector3 } from "@babylonjs/core";

import type { MolvisApp as Molvis } from "../app";
import { viewAtomCoords } from "../io/atom_coords";
import { SelectModifier } from "../modifiers/SelectModifier";

import {
  type Point2D,
  pointInPolygon,
  simplifyPolyline,
} from "../selection/fence";
import { ContextMenuController } from "../ui/menus/controller";
import { isCtrlOrMeta } from "../utils/platform";
import { BaseMode, ModeType } from "./base";
import { CommonMenuItems } from "./menu_items";
import type { HitResult, MenuItem } from "./types";

/**
 * Context menu controller for Select mode.
 */
class SelectModeContextMenu extends ContextMenuController {
  constructor(app: Molvis) {
    super(app, "molvis-select-menu");
  }

  protected shouldShowMenu(
    _hit: HitResult | null,
    isDragging: boolean,
  ): boolean {
    return !isDragging;
  }

  protected buildMenuItems(_hit: HitResult | null): MenuItem[] {
    const items: MenuItem[] = [
      CommonMenuItems.clearSelection(this.app),
      { type: "separator" },
    ];
    return CommonMenuItems.appendCommonTail(items, this.app);
  }
}

function toggleInSet(set: Set<number>, value: number): void {
  if (set.has(value)) {
    set.delete(value);
  } else {
    set.add(value);
  }
}

/**
 * SelectMode with unified pipeline-based selection.
 *
 * Click/fence interactions build a pending selection (preview highlight).
 * The user confirms via confirmPendingSelection() which adds a SelectModifier
 * to the pipeline. All selection logic flows through modifiers.
 */
class SelectMode extends BaseMode {
  private _fenceActive = false;
  private _fenceDrawing = false;
  private _fencePath: Point2D[] = [];
  private _fenceOverlay: SVGSVGElement | null = null;
  private _fenceOverlayPath: SVGPathElement | null = null;

  /** Logical atom IDs in the pending selection (== frame indices for frame atoms). */
  private _pendingAtomIds = new Set<number>();
  /** Logical bond IDs in the pending selection. */
  private _pendingBondIds = new Set<number>();

  constructor(app: Molvis) {
    super(ModeType.Select, app);
  }

  protected createContextMenuController(): ContextMenuController {
    return new SelectModeContextMenu(this.app);
  }

  get isFenceActive(): boolean {
    return this._fenceActive;
  }

  get pendingAtomCount(): number {
    return this._pendingAtomIds.size;
  }

  get pendingBondCount(): number {
    return this._pendingBondIds.size;
  }

  /**
   * Enter fence select mode. Disables camera and prepares for drawing.
   */
  enterFenceMode(): void {
    this._fenceActive = true;
    this._fenceDrawing = false;
    this._fencePath = [];
    this.ensureFenceOverlay();
    this.updateFenceOverlay();
    this.app.world.camera.detachControl();
    this.app.events.emit("fence-select-change", true);
  }

  /**
   * Exit fence select mode. Re-enables camera.
   */
  exitFenceMode(): void {
    this._fenceActive = false;
    this._fenceDrawing = false;
    this._fencePath = [];
    this.disposeFenceOverlay();
    const canvas = this.app.world.scene.getEngine().getRenderingCanvas();
    if (canvas) {
      this.app.world.camera.attachControl(canvas, true);
    }
    this.app.events.emit("fence-select-change", false);
  }

  override start(): void {
    super.start();
    this._pendingAtomIds.clear();
    this._pendingBondIds.clear();
    this.app.world.highlighter.invalidateAndRebuild();
    this._emitPendingChange();
  }

  override finish(): void {
    if (this._fenceActive) {
      this.exitFenceMode();
    }
    this._pendingAtomIds.clear();
    this._pendingBondIds.clear();
    this.app.world.highlighter.highlightPreview([]);
    this.disposeFenceOverlay();
    super.finish();
  }

  override async _on_left_down(pointerInfo: PointerInfo): Promise<void> {
    if (!this._fenceActive) return;

    this._fenceDrawing = true;
    this._fencePath = [
      { x: pointerInfo.event.offsetX, y: pointerInfo.event.offsetY },
    ];
    this.updateFenceOverlay();
  }

  override async _on_left_up(pointerInfo: PointerInfo): Promise<void> {
    if (this._fenceActive && this._fenceDrawing) {
      this.completeFencePreview(pointerInfo);
      return;
    }

    // Click-select: add/remove from pending set (preview only, no pipeline)
    const isCtrl = isCtrlOrMeta(pointerInfo.event);
    const hit = await this.pickHit();

    if (!hit || (hit.type !== "atom" && hit.type !== "bond")) {
      if (!isCtrl) {
        this._pendingAtomIds.clear();
        this._pendingBondIds.clear();
      }
      this._emitPendingChange();
      this.confirmPendingSelection();
      return;
    }

    const meta = hit.metadata;

    if (meta.type === "atom") {
      if (isCtrl) {
        toggleInSet(this._pendingAtomIds, meta.atomId);
      } else {
        this._pendingAtomIds.clear();
        this._pendingBondIds.clear();
        this._pendingAtomIds.add(meta.atomId);
      }
    } else if (meta.type === "bond") {
      if (isCtrl) {
        toggleInSet(this._pendingBondIds, meta.bondId);
      } else {
        this._pendingAtomIds.clear();
        this._pendingBondIds.clear();
        this._pendingBondIds.add(meta.bondId);
      }
    }

    this._emitPendingChange();
    // Auto-confirm click selection immediately
    this.confirmPendingSelection();
  }

  override async _on_pointer_move(pointerInfo: PointerInfo): Promise<void> {
    if (this._fenceActive && this._fenceDrawing) {
      this._fencePath.push({
        x: pointerInfo.event.offsetX,
        y: pointerInfo.event.offsetY,
      });
      this.updateFenceOverlay();
      return;
    }
    return super._on_pointer_move(pointerInfo);
  }

  protected override _on_press_escape(): void {
    if (this._fenceActive) {
      this.exitFenceMode();
    }
  }

  override _on_pointer_pick(_pointerInfo: PointerInfo): void {}

  /**
   * Confirm the pending selection by adding a SelectModifier to the pipeline.
   * Called by the UI "Select" button.
   */
  confirmPendingSelection(): void {
    const atomIndices = [...this._pendingAtomIds];
    const bondIds = [...this._pendingBondIds];
    if (atomIndices.length === 0 && bondIds.length === 0) return;

    this.app.modifierPipeline.addModifier(
      new SelectModifier(
        `manual-sel-${Date.now()}`,
        atomIndices,
        undefined,
        "replace",
        bondIds,
      ),
    );

    // Clear pending state (keep preview highlight until pipeline finishes)
    this._pendingAtomIds.clear();
    this._pendingBondIds.clear();
    this.app.events.emit("pending-selection-change", {
      atomKeys: [],
      bondKeys: [],
    });

    // Apply pipeline; clear preview highlight only after rendering completes
    this.app.applyPipeline({ fullRebuild: true }).then(() => {
      this.app.world.highlighter.highlightPreview([]);
    });
  }

  /**
   * Clear the pending selection without committing.
   */
  clearPending(): void {
    this._pendingAtomIds.clear();
    this._pendingBondIds.clear();
    this._emitPendingChange();
  }

  /**
   * Complete fence selection: project atoms/bonds to screen space,
   * test against polygon, add to pending set (preview only).
   */
  private completeFencePreview(pointerInfo: PointerInfo): void {
    this._fencePath.push({
      x: pointerInfo.event.offsetX,
      y: pointerInfo.event.offsetY,
    });
    this.updateFenceOverlay();

    const polygon = simplifyPolyline(this._fencePath, 3);

    if (polygon.length < 3) {
      this.exitFenceMode();
      return;
    }

    const selectedAtomIndices = this.projectAndSelect(polygon);
    const selectedBondIds = this.projectAndSelectBondIds(polygon);

    const isShift = pointerInfo.event.shiftKey;
    const isCtrl = isCtrlOrMeta(pointerInfo.event);

    if (!isShift && !isCtrl) {
      this._pendingAtomIds.clear();
      this._pendingBondIds.clear();
    }

    if (isCtrl) {
      for (const id of selectedAtomIndices) this._pendingAtomIds.delete(id);
      for (const id of selectedBondIds) this._pendingBondIds.delete(id);
    } else {
      for (const id of selectedAtomIndices) this._pendingAtomIds.add(id);
      for (const id of selectedBondIds) this._pendingBondIds.add(id);
    }

    this._emitPendingChange();
    this.exitFenceMode();

    // Auto-confirm fence selection immediately
    this.confirmPendingSelection();
  }

  /**
   * Resolve pending IDs to selection keys and emit preview highlight + event.
   */
  private _emitPendingChange(): void {
    const atomKeys: string[] = [];
    for (const id of this._pendingAtomIds) {
      const key = this.app.world.sceneIndex.getSelectionKeyForAtom(id);
      if (key) atomKeys.push(key);
    }
    const bondKeys: string[] = [];
    for (const id of this._pendingBondIds) {
      // Use all render instance keys so multi-order bonds are fully highlighted
      const keys = this.app.world.sceneIndex.getSelectionKeysForBond(id);
      for (const key of keys) bondKeys.push(key);
    }

    this.app.world.highlighter.highlightPreview([...atomKeys, ...bondKeys]);
    this.app.events.emit("pending-selection-change", { atomKeys, bondKeys });
  }

  /**
   * Project all atom positions to screen space and return indices
   * for atoms inside the fence polygon.
   */
  private projectAndSelect(polygon: Point2D[]): number[] {
    const frame = this.app.system.frame;
    const atoms = frame?.getBlock("atoms");
    if (!atoms) return [];

    const coords = viewAtomCoords(atoms);
    const xCoords = coords?.x;
    const yCoords = coords?.y;
    const zCoords = coords?.z;
    if (!xCoords || !yCoords || !zCoords) return [];

    const scene = this.app.world.scene;
    const camera = scene.activeCamera;
    if (!camera) return [];

    // Use CSS dimensions (not render-buffer dimensions) because
    // the fence polygon coordinates come from event.offsetX/offsetY
    // which are in CSS pixel space, not device-pixel space.
    const width = this.app.canvas.clientWidth || 1;
    const height = this.app.canvas.clientHeight || 1;
    const viewportMatrix = camera.viewport.toGlobal(width, height);
    const transformMatrix = scene.getTransformMatrix();
    const worldMatrix = Matrix.Identity();

    const atomCount = atoms.nrows();
    const tmpVec = new Vector3();
    const selectedIndices: number[] = [];

    for (let i = 0; i < atomCount; i++) {
      tmpVec.set(xCoords[i], yCoords[i], zCoords[i]);
      const projected = Vector3.Project(
        tmpVec,
        worldMatrix,
        transformMatrix,
        viewportMatrix,
      );

      if (pointInPolygon({ x: projected.x, y: projected.y }, polygon)) {
        selectedIndices.push(i);
      }
    }

    return selectedIndices;
  }

  private projectAndSelectBondIds(polygon: Point2D[]): number[] {
    const scene = this.app.world.scene;
    const camera = scene.activeCamera;
    if (!camera) return [];

    // CSS pixel space to match fence polygon coordinates
    const width = this.app.canvas.clientWidth || 1;
    const height = this.app.canvas.clientHeight || 1;
    const viewportMatrix = camera.viewport.toGlobal(width, height);
    const transformMatrix = scene.getTransformMatrix();
    const worldMatrix = Matrix.Identity();
    const tmpVec = new Vector3();
    const selected: number[] = [];

    for (const bondId of this.app.world.sceneIndex.metaRegistry.bonds.getAllIds()) {
      const meta = this.app.world.sceneIndex.metaRegistry.bonds.getMeta(bondId);
      if (!meta) continue;

      tmpVec.set(
        (meta.start.x + meta.end.x) * 0.5,
        (meta.start.y + meta.end.y) * 0.5,
        (meta.start.z + meta.end.z) * 0.5,
      );
      const projected = Vector3.Project(
        tmpVec,
        worldMatrix,
        transformMatrix,
        viewportMatrix,
      );

      if (pointInPolygon({ x: projected.x, y: projected.y }, polygon)) {
        selected.push(meta.bondId);
      }
    }

    return selected;
  }

  private ensureFenceOverlay(): void {
    if (this._fenceOverlay) {
      this.syncFenceOverlayViewport();
      return;
    }

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("data-role", "molvis-fence-overlay");
    svg.style.position = "absolute";
    svg.style.inset = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.pointerEvents = "none";
    svg.style.overflow = "visible";
    svg.style.zIndex = "20";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "#60a5fa");
    path.setAttribute("fill-opacity", "0.10");
    path.setAttribute("stroke", "#60a5fa");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");

    svg.appendChild(path);
    this.app.uiContainer.appendChild(svg);

    this._fenceOverlay = svg;
    this._fenceOverlayPath = path;
    this.syncFenceOverlayViewport();
  }

  private syncFenceOverlayViewport(): void {
    if (!this._fenceOverlay) return;

    const width =
      this.app.canvas.clientWidth || this.app.displaySize.width || 1;
    const height =
      this.app.canvas.clientHeight || this.app.displaySize.height || 1;
    this._fenceOverlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this._fenceOverlay.setAttribute("preserveAspectRatio", "none");
  }

  private updateFenceOverlay(): void {
    if (!this._fenceOverlayPath) return;

    this.syncFenceOverlayViewport();

    if (this._fencePath.length < 2) {
      this._fenceOverlayPath.setAttribute("d", "");
      return;
    }

    const d = this._fencePath
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
      )
      .join(" ");
    const first = this._fencePath[0];
    const closedPath = `${d} L ${first.x.toFixed(2)} ${first.y.toFixed(2)} Z`;
    this._fenceOverlayPath.setAttribute("d", closedPath);
  }

  private disposeFenceOverlay(): void {
    this._fenceOverlayPath = null;
    if (this._fenceOverlay) {
      this._fenceOverlay.remove();
      this._fenceOverlay = null;
    }
  }
}

export { SelectMode };
