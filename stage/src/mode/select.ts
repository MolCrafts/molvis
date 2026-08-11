import { Matrix, type PointerInfo, Vector3 } from "@babylonjs/core";
import { isCtrlOrMeta } from "@molcrafts/molvis-core/platform";
import type { MolvisApp as Molvis } from "../app";
import { SelectModifier } from "../modifiers/SelectModifier";
import { type Point2D, simplifyPolyline } from "../selection/fence";
import {
  type FenceWorldPoint,
  fenceAtomWorldPoints,
  fenceBondWorldPoints,
  selectIdsInPolygon,
} from "../selection/fence_query";
import { ContextMenuController } from "../ui/menus/controller";
import { BaseMode, ModeType } from "./base";
import { CommonMenuItems } from "./menu_items";
import type { MenuItem, SceneHit } from "./types";

/**
 * Context menu controller for Select mode.
 */
class SelectModeContextMenu extends ContextMenuController {
  constructor(app: Molvis) {
    super(app, "molvis-select-menu");
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

    if (hit?.type === "atom") {
      const atomId = hit.metadata.atomId;
      items.push(
        CommonMenuItems.button("Select Only", () => {
          this.app.world.selectionManager.apply({
            type: "replace",
            atoms: [atomId],
          });
        }),
        CommonMenuItems.button("Add Atom", () => {
          this.app.world.selectionManager.apply({
            type: "add",
            atoms: [atomId],
          });
        }),
      );
    } else if (hit?.type === "bond") {
      const bondId = hit.metadata.bondId;
      items.push(
        CommonMenuItems.button("Select Only", () => {
          this.app.world.selectionManager.apply({
            type: "replace",
            bonds: [bondId],
          });
        }),
        CommonMenuItems.button("Add Bond", () => {
          this.app.world.selectionManager.apply({
            type: "add",
            bonds: [bondId],
          });
        }),
      );
    } else if (hit?.type === "ribbon") {
      items.push(
        CommonMenuItems.button("Select Residue", () => {
          const atoms = atomIdsForResidue(this.app, hit.chainId, hit.resSeq);
          if (atoms.length === 0) return;
          this.app.world.selectionManager.apply({
            type: "replace",
            atoms,
          });
        }),
      );
    }

    items.push(CommonMenuItems.clearSelection(this.app));
    items.push(CommonMenuItems.separator());
    return CommonMenuItems.appendCommonTail(items, this.app);
  }
}

/**
 * Atom ids sharing chain_id + res_seq (ribbon residue pick).
 *
 * Residue columns live on trajectory Frame; identity is still canvas —
 * only ids that exist on SceneIndex are returned (mismatch dropped with
 * no silent frame-only ghosts).
 */
function atomIdsForResidue(
  app: Molvis,
  chainId: string,
  resSeq: number,
): number[] {
  const frame = app.system.frame;
  const atoms = frame?.getBlock("atoms");
  if (!atoms) return [];
  try {
    if (
      atoms.dtype("chain_id") !== "string" ||
      atoms.dtype("res_seq") === undefined
    ) {
      return [];
    }
    const chains = atoms.copyColStr("chain_id") as string[];
    const n = atoms.nrows();
    const candidates: number[] = [];
    if (atoms.dtype("res_seq") === "i32") {
      const seqs = atoms.copyColI32("res_seq");
      for (let i = 0; i < n; i++) {
        if ((chains[i] || "").trim() === chainId && seqs[i] === resSeq) {
          candidates.push(i);
        }
      }
    } else if (atoms.dtype("res_seq") === "u32") {
      const seqs = atoms.copyColU32("res_seq");
      for (let i = 0; i < n; i++) {
        if ((chains[i] || "").trim() === chainId && seqs[i] === resSeq) {
          candidates.push(i);
        }
      }
    }
    const sceneAtoms = app.world.sceneIndex.metaRegistry.atoms;
    return candidates.filter((id) => sceneAtoms.getMeta(id) != null);
  } catch {
    return [];
  }
}

/**
 * SelectMode — what you highlight is the selection (WYSIWYG).
 *
 * Click / fence write {@link SelectionManager} immediately. Highlighter and
 * Python `get_selected` / `event.selection_changed` all read that same store.
 * Optional {@link confirmPendingSelection} only **pushes** the live selection
 * into the modifier pipeline as a {@link SelectModifier} (for hide/color…),
 * not for “making the selection real”.
 */
class SelectMode extends BaseMode {
  private _fenceActive = false;
  private _fenceDrawing = false;
  private _fencePath: Point2D[] = [];
  private _fenceOverlay: SVGSVGElement | null = null;
  private _fenceOverlayPath: SVGPathElement | null = null;

  constructor(app: Molvis) {
    super(ModeType.Select, app);
  }

  protected createContextMenuController(): ContextMenuController {
    return new SelectModeContextMenu(this.app);
  }

  get isFenceActive(): boolean {
    return this._fenceActive;
  }

  /** Live selection size (API alias — not a separate “pending” set). */
  get pendingAtomCount(): number {
    return this.app.world.selectionManager.getSelectedAtomIds().size;
  }

  get pendingBondCount(): number {
    return this.app.world.selectionManager.getSelectedBondIds().size;
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
    this.app.world.highlighter.invalidateAndRebuild();
  }

  override finish(): void {
    if (this._fenceActive) {
      this.exitFenceMode();
    }
    // Drop hover preview only — keep the live selection so View / Manipulate
    // inherit the same set (Select → View must not look like a deselect).
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
      this.completeFenceSelect(pointerInfo);
      return;
    }

    // Click = live selection (replace); Ctrl+click = multi-toggle.
    const isCtrl = isCtrlOrMeta(pointerInfo.event);
    const sm = this.app.world.selectionManager;
    const hit = await this.pickHit();

    if (
      !hit ||
      (hit.type !== "atom" && hit.type !== "bond" && hit.type !== "ribbon")
    ) {
      if (!isCtrl) {
        sm.apply({ type: "clear" });
      }
      return;
    }

    if (hit.type === "ribbon") {
      const residueAtoms = atomIdsForResidue(this.app, hit.chainId, hit.resSeq);
      if (residueAtoms.length === 0) return;
      if (isCtrl) {
        sm.apply({ type: "toggle", atoms: residueAtoms });
      } else {
        sm.apply({ type: "replace", atoms: residueAtoms });
      }
      return;
    }

    const meta = hit.metadata;

    if (meta.type === "atom") {
      if (isCtrl) {
        sm.apply({ type: "toggle", atoms: [meta.atomId] });
      } else {
        sm.apply({ type: "replace", atoms: [meta.atomId] });
      }
    } else if (meta.type === "bond") {
      if (isCtrl) {
        sm.apply({ type: "toggle", bonds: [meta.bondId] });
      } else {
        sm.apply({ type: "replace", bonds: [meta.bondId] });
      }
    }
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
   * Push the **live** selection into the modifier pipeline as a SelectModifier
   * (for hide / color / …). Selection is already real — this does not “confirm”
   * a preview.
   *
   * If the canvas working tree is dirty (edit pool), auto-commits first so
   * SelectModifier ids match dense HEAD rows (user-chosen: auto-commit, not
   * error / one-shot snapshot).
   */
  async confirmPendingSelection(): Promise<void> {
    const sm = this.app.world.selectionManager;
    if (
      sm.getSelectedAtomIds().size === 0 &&
      sm.getSelectedBondIds().size === 0
    ) {
      return;
    }

    if (this.app.world.sceneIndex.hasUnsavedChanges) {
      await this.app.commitScene();
    }

    // Re-read after commit (ids remapped to dense 0..N-1).
    const atomIndices = [...sm.getSelectedAtomIds()].sort((a, b) => a - b);
    const bondIds = [...sm.getSelectedBondIds()].sort((a, b) => a - b);
    if (atomIndices.length === 0 && bondIds.length === 0) return;

    this.app.modifierPipeline.addModifier(
      new SelectModifier(
        `manual-sel-${Date.now()}`,
        atomIndices,
        "replace",
        bondIds,
      ),
    );

    await this.app.applyPipeline({ fullRebuild: true });
  }

  /** Clear the live selection. */
  clearPending(): void {
    this.app.world.selectionManager.apply({ type: "clear" });
  }

  /**
   * Complete fence selection: project atoms/bonds to screen space,
   * test against polygon, update SelectionManager immediately.
   */
  private completeFenceSelect(pointerInfo: PointerInfo): void {
    this._fencePath.push({
      x: pointerInfo.event.offsetX,
      y: pointerInfo.event.offsetY,
    });
    this.updateFenceOverlay();

    const polygon = simplifyPolyline(this._fencePath, 3);

    if (polygon.length < 3) {
      // Abort this draw — keep fence active for another attempt
      this._fenceDrawing = false;
      this._fencePath = [];
      this.updateFenceOverlay();
      return;
    }

    const selectedAtomIndices = this.projectAndSelect(polygon);
    const selectedBondIds = this.projectAndSelectBondIds(polygon);

    const isShift = pointerInfo.event.shiftKey;
    const isCtrl = isCtrlOrMeta(pointerInfo.event);
    const sm = this.app.world.selectionManager;

    // no-modifier = replace, Shift = extend, Ctrl = remove
    if (isCtrl) {
      sm.apply({
        type: "remove",
        atoms: selectedAtomIndices,
        bonds: selectedBondIds,
      });
    } else if (isShift) {
      sm.apply({
        type: "add",
        atoms: selectedAtomIndices,
        bonds: selectedBondIds,
      });
    } else {
      sm.apply({
        type: "replace",
        atoms: selectedAtomIndices,
        bonds: selectedBondIds,
      });
    }

    // Reset drawing state — fence stays active for the next region
    this._fenceDrawing = false;
    this._fencePath = [];
    this.updateFenceOverlay();
  }

  /**
   * Project live-scene atom positions (frame + edit) to screen space and
   * return logical atom ids inside the fence polygon.
   *
   * Must use metaRegistry, not `system.frame` alone — edit atoms from sketch /
   * place / draw live only in the scene overlay until commit, while bonds were
   * already sourced from metaRegistry (so fence looked “bond-only”).
   */
  private projectAndSelect(polygon: Point2D[]): number[] {
    return this.projectMetaPoints(
      polygon,
      fenceAtomWorldPoints(this.app.world.sceneIndex.metaRegistry.atoms),
    );
  }

  private projectAndSelectBondIds(polygon: Point2D[]): number[] {
    return this.projectMetaPoints(
      polygon,
      fenceBondWorldPoints(this.app.world.sceneIndex.metaRegistry.bonds),
    );
  }

  /**
   * Project world points with the active camera into CSS pixel space (matches
   * pointer `offsetX`/`offsetY` used for the fence path).
   */
  private projectMetaPoints(
    polygon: Point2D[],
    points: FenceWorldPoint[],
  ): number[] {
    const scene = this.app.world.scene;
    const camera = scene.activeCamera;
    if (!camera) return [];

    const width = this.app.canvas.clientWidth || 1;
    const height = this.app.canvas.clientHeight || 1;
    const viewportMatrix = camera.viewport.toGlobal(width, height);
    const transformMatrix = scene.getTransformMatrix();
    const worldMatrix = Matrix.Identity();
    const tmpVec = new Vector3();

    return selectIdsInPolygon(polygon, points, (x, y, z) => {
      tmpVec.set(x, y, z);
      const projected = Vector3.Project(
        tmpVec,
        worldMatrix,
        transformMatrix,
        viewportMatrix,
      );
      return { x: projected.x, y: projected.y };
    });
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
