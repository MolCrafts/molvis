import { type PointerInfo, Vector3 } from "@babylonjs/core";
import type { MolvisApp } from "../app";
import {
  type BondCriterion,
  ComputeBondsModifier,
} from "../modifiers/ComputeBondsModifier";
import { WrapPBCModifier } from "../modifiers/WrapPBCModifier";
import { ContextMenuController } from "../ui/menus/controller";
import { BaseMode, ModeType } from "./base";
import { CommonMenuItems } from "./menu_items";
import type { HitResult, MenuItem } from "./types";

/**
 * Context menu controller for View mode.
 * Shows menu on any right-click (if not dragging).
 */
class ViewModeContextMenu extends ContextMenuController {
  constructor(
    app: MolvisApp,
    private mode: ViewMode,
  ) {
    super(app, "molvis-view-menu");
  }

  protected shouldShowMenu(
    _hit: HitResult | null,
    isDragging: boolean,
  ): boolean {
    // Show menu on any right-click (if not dragging)
    return !isDragging;
  }

  protected buildMenuItems(_hit: HitResult | null): MenuItem[] {
    const items: MenuItem[] = [CommonMenuItems.resetCamera(this.app)];

    // Dynamic bonding — perceive bonds from geometry for topology-less
    // formats (xyz, LAMMPS dump). Toggle + criterion live in a submenu.
    const bondingOn = this.mode.isDynamicBondingEnabled();
    const criterion = this.mode.getBondingCriterion();
    const canCovalent = this.mode.canUseCovalentBonding();
    items.push(
      CommonMenuItems.submenu("Dynamic Bonding", [
        {
          type: "button",
          title: bondingOn ? "Turn Off" : "Turn On",
          action: () => {
            this.mode.setDynamicBondingEnabled(!bondingOn);
          },
        },
        { type: "separator" },
        {
          type: "button",
          title: `${criterion === "covalent" ? "● " : "○ "}Covalent${
            canCovalent ? "" : " (needs elements)"
          }`,
          action: () => {
            if (canCovalent) this.mode.setBondingCriterion("covalent");
          },
        },
        {
          type: "button",
          title: `${criterion === "distance" ? "● " : "○ "}Distance`,
          action: () => {
            this.mode.setBondingCriterion("distance");
          },
        },
      ]),
    );

    // Display toggles. Wrap PBC is a no-op when every atom is already inside
    // the box (typical for X-ray asymmetric units), so don't expect a visible
    // diff unless atoms span beyond the cell.
    const gridEnabled = this.mode.isGridEnabled();
    const pbcEnabled = this.mode.isPbcEnabled();
    items.push(
      CommonMenuItems.submenu("Display", [
        {
          type: "button",
          title: gridEnabled ? "Grid: On" : "Grid: Off",
          action: () => {
            this.mode.setGridEnabled(!gridEnabled);
          },
        },
        {
          type: "button",
          title: pbcEnabled ? "Wrap PBC: On" : "Wrap PBC: Off",
          action: () => {
            this.mode.setPbcEnabled(!pbcEnabled);
          },
        },
      ]),
    );

    items.push({ type: "separator" });
    return CommonMenuItems.appendCommonTail(items, this.app);
  }
}

class ViewMode extends BaseMode {
  private static readonly DOUBLE_CLICK_THRESHOLD_MS = 300;

  private lastClickTime = 0;
  private _diameterRafId: number | null = null;

  constructor(app: MolvisApp) {
    super(ModeType.View, app);
  }

  protected createContextMenuController(): ContextMenuController {
    return new ViewModeContextMenu(this.app, this);
  }

  public isGridEnabled(): boolean {
    return this.app.world.grid ? this.app.world.grid.isEnabled : false;
  }

  public setGridEnabled(enabled: boolean): void {
    if (this.app.world.grid) {
      if (enabled) {
        this.app.world.grid.enable();
      } else {
        this.app.world.grid.disable();
      }
    }
  }

  public getAtomDiameterScale(): number {
    return this.app.styleManager.getAtomRadiusScale();
  }

  public getBondDiameterScale(): number {
    return this.app.styleManager.getBondRadiusScale();
  }

  public setAtomDiameterScale(scale: number): void {
    const clamped = Math.min(2.0, Math.max(0.2, scale));
    this.app.styleManager.setAtomRadiusScale(clamped);
    this.scheduleStyleRedraw();
  }

  public setBondDiameterScale(scale: number): void {
    const clamped = Math.min(2.0, Math.max(0.2, scale));
    this.app.styleManager.setBondRadiusScale(clamped);
    this.scheduleStyleRedraw();
  }

  /** Debounce style redraws to at most one per animation frame. */
  private scheduleStyleRedraw(): void {
    if (this._diameterRafId !== null) return;
    this._diameterRafId = requestAnimationFrame(() => {
      this._diameterRafId = null;
      this.app.renderFrame(this.app.system.frame, this.app.system.box);
    });
  }

  public isPbcEnabled(): boolean {
    for (const modifier of this.getWrapPbcModifiers()) {
      if (modifier.enabled) {
        return true;
      }
    }
    return false;
  }

  public setPbcEnabled(enabled: boolean): void {
    const pipeline = this.app.modifierPipeline;
    const modifiers = this.getWrapPbcModifiers();

    if (enabled) {
      if (modifiers.length === 0) {
        pipeline.addModifier(new WrapPBCModifier(`wrap-pbc-${Date.now()}`));
      } else {
        for (const modifier of modifiers) {
          modifier.enabled = true;
        }
      }
    } else {
      for (const modifier of modifiers) {
        modifier.enabled = false;
      }
    }

    void this.app.applyPipeline({ fullRebuild: true });
  }

  private getWrapPbcModifiers(): WrapPBCModifier[] {
    return this.app.modifierPipeline
      .getModifiers()
      .filter(
        (modifier): modifier is WrapPBCModifier =>
          modifier instanceof WrapPBCModifier,
      );
  }

  // ---- Dynamic bonding -----------------------------------------------------

  public isDynamicBondingEnabled(): boolean {
    return this.getComputeBondsModifiers().some((m) => m.enabled);
  }

  public setDynamicBondingEnabled(enabled: boolean): void {
    const pipeline = this.app.modifierPipeline;
    const modifiers = this.getComputeBondsModifiers();

    if (enabled) {
      if (modifiers.length === 0) {
        const mod = new ComputeBondsModifier();
        // Covalent needs an element column (xyz has one); numeric-type-only
        // frames (e.g. LAMMPS dump) fall back to distance.
        mod.criterion = ComputeBondsModifier.hasElementData(
          this.app.system.frame,
        )
          ? "covalent"
          : "distance";
        // addModifier auto-positions a TransformsData-only modifier before the
        // first Draw modifier, so the perceived bonds reach DrawBond.
        pipeline.addModifier(mod);
      } else {
        for (const modifier of modifiers) modifier.enabled = true;
      }
    } else {
      for (const modifier of modifiers) modifier.enabled = false;
    }

    void this.app.applyPipeline({ fullRebuild: true });
  }

  public getBondingCriterion(): BondCriterion {
    const modifiers = this.getComputeBondsModifiers();
    return modifiers.length > 0 ? modifiers[0].criterion : "covalent";
  }

  public setBondingCriterion(criterion: BondCriterion): void {
    for (const modifier of this.getComputeBondsModifiers()) {
      modifier.criterion = criterion;
    }
    void this.app.applyPipeline({ fullRebuild: true });
  }

  /** Whether the current frame carries the element column the covalent
   *  criterion needs (gates the criterion submenu). */
  public canUseCovalentBonding(): boolean {
    return ComputeBondsModifier.hasElementData(this.app.system.frame);
  }

  private getComputeBondsModifiers(): ComputeBondsModifier[] {
    return this.app.modifierPipeline
      .getModifiers()
      .filter(
        (modifier): modifier is ComputeBondsModifier =>
          modifier instanceof ComputeBondsModifier,
      );
  }

  /**
   * Start ViewMode - activate 3D scene helpers
   */
  public start(): void {
    super.start();

    // Invalidate highlights for mode switch (View uses thin instances)
    this.app.world.highlighter.invalidateAndRebuild();
  }

  /**
   * Finish ViewMode - deactivate 3D scene helpers
   */
  public finish(): void {
    if (this._diameterRafId !== null) {
      cancelAnimationFrame(this._diameterRafId);
      this._diameterRafId = null;
    }
    this.world.targetIndicator.hide();

    super.finish();
  }

  override async _on_pointer_down(pointerInfo: PointerInfo) {
    await super._on_pointer_down(pointerInfo);

    // Detect double-click
    const now = Date.now();
    const timeSinceLastClick = now - this.lastClickTime;

    if (
      timeSinceLastClick < ViewMode.DOUBLE_CLICK_THRESHOLD_MS &&
      pointerInfo.event.button === 0
    ) {
      // Left button only
      await this.handleDoubleClick();
    }

    this.lastClickTime = now;
  }

  /**
   * Handle double-click to set camera target (like Ovito)
   */
  private async handleDoubleClick(): Promise<void> {
    const hit = await this.pickHit();

    if (hit && (hit.type === "atom" || hit.type === "bond")) {
      let target: Vector3 | null = null;
      if (hit.type === "atom") {
        target = new Vector3(
          hit.metadata.position.x,
          hit.metadata.position.y,
          hit.metadata.position.z,
        );
      } else if (hit.type === "bond") {
        // Midpoint of bond from metadata
        const start = hit.metadata.start;
        const end = hit.metadata.end;
        target = new Vector3(
          (start.x + end.x) / 2,
          (start.y + end.y) / 2,
          (start.z + end.z) / 2,
        );
      }

      if (target) {
        // Only set camera target, don't move camera position (Ovito-like behavior)
        this.world.camera.setTarget(target);

        // Show target indicator at the picked point
        this.world.targetIndicator.show(target);
      }
    }
  }

  override async _on_pointer_up(pointerInfo: PointerInfo) {
    await super._on_pointer_up(pointerInfo);
  }

  override async _on_pointer_move(_pointerInfo: PointerInfo) {
    // ViewMode inherits atom info display functionality from BaseMode
    await super._on_pointer_move(_pointerInfo);
  }

  override _on_press_q(): void {
    this.app.prevFrame();
  }

  override _on_press_e(): void {
    this.app.nextFrame();
  }
}

export { ViewMode };
