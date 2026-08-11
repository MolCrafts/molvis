import type {
  AbstractMesh,
  KeyboardInfo,
  Observer,
  PointerInfo,
} from "@babylonjs/core";
import {
  KeyboardEventTypes,
  PointerEventTypes,
  Vector2,
  Vector3,
} from "@babylonjs/core";
import { isCtrlOrMeta } from "@molcrafts/molvis-core/platform";
import type { MolvisApp as Molvis } from "../app";
import type { ContextMenuController } from "../ui/menus/controller";
import { formatBondLabel } from "../utils/bond_order";
import type { ModeId } from "./mode_type";
import { resolvePointerSpacePosition } from "./placement_position";
import type { SceneHit } from "./types";

/**
 * Base class for all interaction modes.
 *
 * Event Flow Architecture:
 * ========================
 * Right-click events follow a layered approach:
 * 1. Event arrives at _on_right_up()
 * 2. Mode picks the hit result (atom/bond/empty)
 * 3. Context menu controller decides whether to show menu
 * 4. If menu is shown, event is consumed
 * 5. If not consumed, mode handles it via onRightClickNotConsumed()
 *
 * Each mode must implement:
 * - createContextMenuController(): Create mode-specific menu controller
 * - onRightClickNotConsumed(): Handle right-click when menu doesn't consume it
 */
/** True when keyboard focus is in a text field (don't steal Delete). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const el = target as HTMLElement;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  // Shadow hosts (element picker, menu bindings)
  if (el.closest?.("molvis-element-picker, molvis-slider, molvis-context-menu"))
    return true;
  return false;
}

abstract class BaseMode {
  /** Built-in {@link ModeType} or a plugin-registered id. */
  name: ModeId;

  private _app: Molvis;
  private _pointer_observer: Observer<PointerInfo>;
  private _kb_observer: Observer<KeyboardInfo>;
  private _infoLastText = "";
  private _hoverPickRaf: number | null = null;
  private _hoverPickScheduled = false;
  private _hoverPickInFlight = false;
  private _hoverPickDirty = false;
  private _hoverPointerX = Number.NaN;
  private _hoverPointerY = Number.NaN;
  private _hoverLastPickedX = Number.NaN;
  private _hoverLastPickedY = Number.NaN;
  private _pointerButtons = 0;
  private _interactionEpoch = 0;
  protected _pointer_down_xy: Vector2 = new Vector2();
  protected _pointer_up_xy: Vector2 = new Vector2();

  /**
   * Flag to enable/disable hover highlighting.
   * Defaults to false. Subclasses can enable it.
   */
  protected enableHoverHighlight = false;

  // Context menu controller (mode-specific)
  protected contextMenuController!: ContextMenuController;

  constructor(name: ModeId, app: Molvis) {
    this._app = app;
    this.name = name;
    this._pointer_observer = this.register_pointer_events();
    this._kb_observer = this.register_keyboard_events();
    this.initContextMenu();
  }

  protected get scene() {
    return this._app.world.scene;
  }

  protected get app() {
    return this._app;
  }

  protected get world() {
    return this._app.world;
  }

  get type(): ModeId {
    return this.name;
  }

  protected get _is_dragging() {
    return this._pointer_up_xy.subtract(this._pointer_down_xy).length() > 0.2;
  }

  /**
   * Initialize the context menu controller.
   * Calls the abstract createContextMenuController() method.
   */
  private initContextMenu() {
    this.contextMenuController = this.createContextMenuController();
  }

  /**
   * Create mode-specific context menu controller.
   * Must be implemented by each mode.
   */
  protected abstract createContextMenuController(): ContextMenuController;

  /**
   * Handle right-click when context menu doesn't consume the event.
   * Override in subclasses for mode-specific right-click behavior.
   */
  protected onRightClickNotConsumed(
    _pointerInfo: PointerInfo,
    _hit: SceneHit | null,
  ): void {
    // Default: do nothing
  }

  public takeScreenShot(): void {
    this.world?.takeScreenShot();
  }

  /**
   * Start the mode - called when mode is activated.
   * Override in subclasses to initialize mode-specific features.
   */
  public start(): void {
    // Default implementation - subclasses can override
  }

  public finish() {
    this._interactionEpoch += 1;
    this.cancelHoverPick();
    this.unregister_pointer_events();
    this.unregister_keyboard_events();
    if (this.contextMenuController) {
      this.contextMenuController.dispose();
    }
  }

  private unregister_pointer_events = () => {
    this.scene.onPointerObservable.remove(this._pointer_observer);
  };

  private unregister_keyboard_events = () => {
    this.scene.onKeyboardObservable.remove(this._kb_observer);
  };

  private register_pointer_events() {
    const swallow = (p: Promise<void>) => {
      p.catch((err) => console.error("[Molvis] pointer handler error:", err));
    };

    return this.scene.onPointerObservable.add((pointerInfo: PointerInfo) => {
      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERDOWN:
          swallow(this._on_pointer_down(pointerInfo));
          break;
        case PointerEventTypes.POINTERUP:
          swallow(this._on_pointer_up(pointerInfo));
          break;
        case PointerEventTypes.POINTERMOVE:
          swallow(this._on_pointer_move(pointerInfo));
          break;
        case PointerEventTypes.POINTERWHEEL:
          this._on_pointer_wheel(pointerInfo);
          break;
        case PointerEventTypes.POINTERPICK:
          this._on_pointer_pick(pointerInfo);
          break;
        case PointerEventTypes.POINTERTAP:
          this._on_pointer_tap(pointerInfo);
          break;
        case PointerEventTypes.POINTERDOUBLETAP:
          this._on_pointer_double_tap(pointerInfo);
          break;
      }
    });
  }

  private register_keyboard_events = () => {
    return this.scene.onKeyboardObservable.add((kbInfo: KeyboardInfo) => {
      switch (kbInfo.type) {
        case KeyboardEventTypes.KEYDOWN:
          if (isCtrlOrMeta(kbInfo.event)) {
            switch (kbInfo.event.key) {
              case "s":
                kbInfo.event.preventDefault();
                this._on_press_ctrl_s();
                break;
              case "z":
                kbInfo.event.preventDefault();
                this._on_press_ctrl_z();
                break;
              case "y":
                kbInfo.event.preventDefault();
                this._on_press_ctrl_y();
                break;
              case "c":
                this._on_press_ctrl_c();
                break;
              case "v":
                this._on_press_ctrl_v();
                break;
            }
          } else {
            switch (kbInfo.event.key) {
              case "e":
                this._on_press_e();
                break;
              case "q":
                this._on_press_q();
                break;
              case "g":
              case "G":
                if (!isTypingTarget(kbInfo.event.target)) {
                  this._on_press_g();
                }
                break;
              case "r":
              case "R":
                if (!isTypingTarget(kbInfo.event.target)) {
                  this._on_press_r();
                }
                break;
              case "Escape":
                this._on_press_escape();
                break;
              case "Delete":
              case "Backspace":
                if (!isTypingTarget(kbInfo.event.target)) {
                  kbInfo.event.preventDefault();
                  this._on_press_delete();
                }
                break;
            }
          }
          break;
      }
    });
  };

  /**
   * Pick and create a SceneHit from the current pointer position.
   * Returns hit information about what's under the cursor.
   */
  protected async pickHit(): Promise<SceneHit | null> {
    return this.app.pickAtPointer(this.scene.pointerX, this.scene.pointerY);
  }

  /**
   * Project the current scene pointer onto a screen-aligned plane in world
   * space. Shared placement algorithm — see {@link resolvePointerSpacePosition}.
   * Returns null when projection fails, so callers can safely bail out.
   */
  protected projectPointerOnScreenPlane(anchor?: Vector3): Vector3 | null {
    return resolvePointerSpacePosition({
      scene: this.scene,
      camera: this.world.camera,
      pointerX: this.scene.pointerX,
      pointerY: this.scene.pointerY,
      anchor,
    });
  }

  async _on_pointer_down(pointerInfo: PointerInfo): Promise<void> {
    this._pointer_down_xy = this.get_pointer_xy();
    this._pointerButtons = pointerInfo.event.buttons ?? 0;

    if (pointerInfo.event.button === 0) {
      await this._on_left_down(pointerInfo);
    } else if (pointerInfo.event.button === 2) {
      await this._on_right_down(pointerInfo);
    }
  }

  async _on_pointer_up(pointerInfo: PointerInfo): Promise<void> {
    this._pointer_up_xy = this.get_pointer_xy();
    this._pointerButtons = pointerInfo.event.buttons ?? 0;

    if (pointerInfo.event.button === 0) {
      await this._on_left_up(pointerInfo);
    } else if (pointerInfo.event.button === 2) {
      await this._on_right_up(pointerInfo);
    }

    if (this._pointerButtons === 0 && this._hoverPickDirty) {
      this.scheduleHoverPick();
    }
  }

  protected async _on_left_down(_pointerInfo: PointerInfo): Promise<void> {
    // Override in subclasses
  }

  protected async _on_left_up(_pointerInfo: PointerInfo): Promise<void> {
    // Override in subclasses
  }

  protected async _on_right_down(_pointerInfo: PointerInfo): Promise<void> {
    // Override in subclasses
  }

  /**
   * Right-click handler with layered event flow.
   *
   * Flow:
   * 1. Pick what's under the cursor
   * 2. Let context menu controller decide if it wants to handle this
   * 3. If menu consumes event (shows menu), we're done
   * 4. Otherwise, delegate to mode-specific logic via onRightClickNotConsumed()
   */
  protected async _on_right_up(pointerInfo: PointerInfo): Promise<void> {
    // Pick what's under the cursor
    const hit = await this.pickHit();

    // Let context menu controller handle it first
    const consumed = this.contextMenuController.handleRightClick(
      pointerInfo.event,
      hit,
      this._is_dragging,
    );

    // If not consumed by menu, let mode handle it
    if (!consumed) {
      this.onRightClickNotConsumed(pointerInfo, hit);
    }
  }

  async _on_pointer_move(pointerInfo: PointerInfo): Promise<void> {
    this._pointerButtons = pointerInfo.event.buttons ?? 0;
    this.queueHoverPick(this.scene.pointerX, this.scene.pointerY);
  }

  protected formatHitInfo(hit: SceneHit | null): string {
    if (!hit || hit.type === "empty") {
      return "";
    }
    if (hit.type === "ribbon") {
      return `Residue ${hit.resName} ${hit.resSeq} · chain ${hit.chainId}`;
    }
    if (hit.type === "atom") {
      const { element, position, atomId } = hit.metadata;
      const residue = this.residueLabelForAtom(atomId);
      const el = element?.trim() || "Atom";
      const xyz = `(${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}) Å`;
      const atomPart = `Atom ${el} · ID ${atomId} · ${xyz}`;
      return residue ? `${residue} · ${atomPart}` : atomPart;
    }
    const { start, end, atomId1, atomId2, bondType, bondNumber } = hit.metadata;
    const length = Vector3.Distance(
      new Vector3(start.x, start.y, start.z),
      new Vector3(end.x, end.y, end.z),
    );
    const kind = formatBondLabel(bondType, bondNumber);
    return `Bond ${atomId1}–${atomId2} · ${length.toFixed(2)} Å · ${kind}`;
  }

  /**
   * `THR 222 · chain A` when trajectory Frame carries residue columns.
   * Atom must exist on SceneIndex (canvas); columns are reverse-lookup only.
   */
  private residueLabelForAtom(atomId: number): string | null {
    if (this.app.world.sceneIndex.metaRegistry.atoms.getMeta(atomId) == null) {
      return null;
    }
    const frame = this.app.system.frame;
    const atoms = frame?.getBlock("atoms");
    if (!atoms || atomId < 0 || atomId >= atoms.nrows()) return null;
    try {
      if (
        atoms.dtype("res_name") !== "string" ||
        atoms.dtype("chain_id") !== "string"
      ) {
        return null;
      }
      const resName = (atoms.copyColStr("res_name") as string[])[
        atomId
      ]?.trim();
      const chainId =
        (atoms.copyColStr("chain_id") as string[])[atomId]?.trim() || "A";
      let resSeq: number | null = null;
      if (atoms.dtype("res_seq") === "i32") {
        resSeq = atoms.copyColI32("res_seq")[atomId];
      } else if (atoms.dtype("res_seq") === "u32") {
        resSeq = atoms.copyColU32("res_seq")[atomId];
      }
      if (!resName || resSeq === null || !Number.isFinite(resSeq)) return null;
      return `${resName} ${resSeq} · chain ${chainId}`;
    } catch {
      return null;
    }
  }

  _on_pointer_wheel(_pointerInfo: PointerInfo): void {}
  _on_pointer_pick(_pointerInfo: PointerInfo): void {}
  _on_pointer_tap(_pointerInfo: PointerInfo): void {}
  _on_pointer_double_tap(_pointerInfo: PointerInfo): void {}
  _on_press_e(): void {}

  _on_press_q(): void {}

  /** Blender-style grab (G) — override in manipulate mode. */
  protected _on_press_g(): void {}

  /** Blender-style rotate (R) — override in manipulate mode. */
  protected _on_press_r(): void {}

  protected _on_press_escape(): void {
    // Override in subclasses for custom escape behavior
  }

  /** Delete / Backspace — override in edit (and similar) modes. */
  protected _on_press_delete(): void {
    // Default: no-op
  }

  /**
   * Discard unsaved scene changes by re-rendering from system.frame.
   * If there are no unsaved changes, this is a no-op.
   */
  protected restoreSceneFromFrame(): void {
    if (!this.app.world.sceneIndex.hasUnsavedChanges) {
      return;
    }
    const frame = this.app.system.frame;
    if (frame) {
      this.app.renderFrame(frame);
    }
    this.app.world.sceneIndex.markAllSaved();
  }

  /**
   * Save is a **global** operation (any mode): commit the SceneIndex working
   * tree into system HEAD + primary DataSource. Modes must not gate this.
   */
  protected _on_press_ctrl_s(): void {
    void this.app.commitScene().catch((err) => {
      console.error("[Molvis] commitScene failed:", err);
    });
  }
  protected _on_press_ctrl_z(): void {}
  protected _on_press_ctrl_y(): void {}
  protected _on_press_ctrl_c(): void {}
  protected _on_press_ctrl_v(): void {}

  protected get_pointer_xy(): Vector2 {
    return new Vector2(this.scene.pointerX, this.scene.pointerY);
  }

  /**
   * True when the DOM hit under the pointer is workbench chrome (panel
   * resize handle, etc.) rather than the free canvas. Edit modes must not
   * place atoms while the user is dragging a side rail.
   */
  protected isPointerOnWorkbenchChrome(ev: {
    clientX: number;
    clientY: number;
  }): boolean {
    if (typeof document === "undefined") return false;
    const top = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!top || !(top instanceof Element)) return false;
    if (top.closest("[data-slot='resizable-handle']")) return true;
    // react-resizable-panels may mark the active separator while dragging
    if (top.closest("[data-resize-handle-active]")) return true;
    if (top.closest("[data-panel-resize-handle-id]")) return true;
    return false;
  }

  /**
   * Left/right canvas margin where side-panel grips live. Clicks here are
   * treated as panel chrome, not edit placement.
   */
  protected isPointerNearCanvasSideEdge(ev: {
    clientX: number;
    clientY: number;
  }): boolean {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const pad = 16; // px — covers grip hit pad even when collapsed to 0%
    if (ev.clientX - rect.left <= pad) return true;
    if (rect.right - ev.clientX <= pad) return true;
    return false;
  }

  private queueHoverPick(pointerX: number, pointerY: number): void {
    if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
      return;
    }

    this._hoverPointerX = pointerX;
    this._hoverPointerY = pointerY;
    this._hoverPickDirty = true;

    if (!this.shouldRunHoverPickNow()) {
      return;
    }

    this.scheduleHoverPick();
  }

  private shouldRunHoverPickNow(): boolean {
    return this._pointerButtons === 0;
  }

  private scheduleHoverPick(): void {
    if (this._hoverPickScheduled || this._hoverPickInFlight) {
      return;
    }

    this._hoverPickScheduled = true;
    this._hoverPickRaf = window.requestAnimationFrame(() => {
      this._hoverPickScheduled = false;
      this._hoverPickRaf = null;
      void this.processHoverPick();
    });
  }

  private async processHoverPick(): Promise<void> {
    if (!this._hoverPickDirty || this._hoverPickInFlight) {
      return;
    }

    if (!this.shouldRunHoverPickNow()) {
      return;
    }

    const pointerX = this._hoverPointerX;
    const pointerY = this._hoverPointerY;
    this._hoverPickDirty = false;

    if (
      pointerX === this._hoverLastPickedX &&
      pointerY === this._hoverLastPickedY
    ) {
      return;
    }

    this._hoverPickInFlight = true;
    this._hoverLastPickedX = pointerX;
    this._hoverLastPickedY = pointerY;
    const epoch = this._interactionEpoch;

    try {
      const hit = await this.app.pickAtPointer(pointerX, pointerY);
      if (epoch !== this._interactionEpoch) {
        return;
      }
      this.emitInfoTextIfChanged(this.formatHitInfo(hit));
    } catch (err) {
      // Hover-pick is fire-and-forget background work — never let it
      // escape as an unhandled-promise-rejection. Most common cause is
      // a transient WASM/molvis-core/molrs error mid-frame; the next frame will
      // re-render and the next hover will retry.
      console.warn("hover pick failed", err);
    } finally {
      this._hoverPickInFlight = false;
      // Only chain the next hover-pick when this interaction is still current
      // (epoch unchanged). Guarded as a single positive condition rather than
      // an early `return` — a `return` inside `finally` would override the
      // control flow of the `try`/`catch` above.
      if (
        epoch === this._interactionEpoch &&
        this._hoverPickDirty &&
        this.shouldRunHoverPickNow()
      ) {
        this.scheduleHoverPick();
      }
    }
  }

  private emitInfoTextIfChanged(text: string): void {
    if (this._infoLastText === text) {
      return;
    }

    this._infoLastText = text;
    this.app.events.emit("info-text-change", text);
  }

  private cancelHoverPick(): void {
    if (this._hoverPickRaf !== null) {
      window.cancelAnimationFrame(this._hoverPickRaf);
      this._hoverPickRaf = null;
    }
    this._hoverPickScheduled = false;
    this._hoverPickInFlight = false;
    this._hoverPickDirty = false;
  }

  protected async pick_mesh(
    type: "atom" | "bond",
  ): Promise<AbstractMesh | null> {
    const hit = await this.pickHit();
    if (hit && hit.type === type && hit.mesh) {
      return hit.mesh;
    }
    return null;
  }
}

export type { ModeId } from "./mode_type";
export { ModeType } from "./mode_type";
export { BaseMode };
