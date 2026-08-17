import type { Scene } from "@babylonjs/core";
import { AdvancedDynamicTexture } from "@babylonjs/gui";
import { EventEmitter } from "../events";
import type { Overlay, OverlayEventMap } from "./types";

/**
 * Manages all overlay objects for a MolvisApp instance.
 *
 * Owns the shared AdvancedDynamicTexture used by all TextLabelOverlays,
 * lazily initialized on first access so tests that don't use text labels
 * can skip BabylonJS GUI setup.
 *
 * Prefer using Commands (AddOverlayCommand, RemoveOverlayCommand) over calling
 * add/remove directly so operations are undo/redo-able.
 */
export class OverlayManager extends EventEmitter<OverlayEventMap> {
  private _overlays = new Map<string, Overlay>();
  private _scene: Scene;
  private _labelTexture: AdvancedDynamicTexture | null = null;

  constructor(scene: Scene) {
    super();
    this._scene = scene;
  }

  /**
   * The shared fullscreen GUI texture for TextLabelOverlays.
   * Lazily created on first access.
   */
  get labelTexture(): AdvancedDynamicTexture {
    if (!this._labelTexture) {
      this._labelTexture = AdvancedDynamicTexture.CreateFullscreenUI(
        "__molvis_overlay_labels__",
        true,
        this._scene,
      );
    }
    return this._labelTexture;
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  add<T extends Overlay>(overlay: T): T {
    this._overlays.set(overlay.id, overlay);
    this.emit("overlay-added", { overlay });
    return overlay;
  }

  remove(id: string): void {
    const overlay = this._overlays.get(id);
    if (!overlay) return;
    overlay.dispose();
    this._overlays.delete(id);
    this.emit("overlay-removed", { id });
  }

  get(id: string): Overlay | undefined {
    return this._overlays.get(id);
  }

  list(): readonly Overlay[] {
    return Array.from(this._overlays.values());
  }

  /** Number of registered overlays. Cheap (no array allocation). */
  get size(): number {
    return this._overlays.size;
  }

  // ── Batch ──────────────────────────────────────────────────────────────────

  addMany(overlays: Overlay[]): void {
    for (const o of overlays) this.add(o);
  }

  removeMany(ids: string[]): void {
    for (const id of ids) this.remove(id);
  }

  // ── Visibility ─────────────────────────────────────────────────────────────

  setVisible(id: string, visible: boolean): void {
    const overlay = this._overlays.get(id);
    if (!overlay) return;
    overlay.visible = visible;
    this.emit("overlay-changed", { overlay });
  }

  // ── Per-frame hook ─────────────────────────────────────────────────────────

  /**
   * Called once per render frame by World.renderOnce().
   * Delegates to each overlay that implements updateScreenPositions().
   */
  updateScreenPositions(): void {
    for (const overlay of this._overlays.values()) {
      overlay.updateScreenPositions?.();
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  clear(): void {
    for (const overlay of this._overlays.values()) {
      overlay.dispose();
    }
    this._overlays.clear();
  }

  dispose(): void {
    this.clear();
    if (this._labelTexture) {
      this._labelTexture.dispose();
      this._labelTexture = null;
    }
    super.clear();
  }
}
