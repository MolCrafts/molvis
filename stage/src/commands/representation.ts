import type { MolvisApp } from "../app";
import {
  Material,
  type MaterialInput,
  type MaterialStyle,
  type MaterialTarget,
} from "../artist/material";
import {
  type BondColorMode,
  Representation,
  type RepresentationStyle,
} from "../artist/representation";
import type { OutlineStyle } from "../artist/visual_preset";
import { Settings } from "../settings";
import { Command } from "./base";

export interface VisualStyleChange {
  representation?: RepresentationStyle;
  materials?: Partial<Record<MaterialTarget, MaterialInput>>;
  bondColorMode?: BondColorMode;
  outline?: Partial<OutlineStyle>;
}

/** A single transactional geometry/complete-look edit. Unchanged layers stay untouched. */
export class SetVisualStyleCommand extends Command<void> {
  private readonly next: VisualStyleChange;
  private readonly prev: VisualStyleChange;

  constructor(app: MolvisApp, change: VisualStyleChange) {
    super(app);
    const materials: Partial<Record<MaterialTarget, MaterialStyle>> = {};
    const previousMaterials: Partial<Record<MaterialTarget, MaterialStyle>> =
      {};
    for (const [target, input] of Object.entries(change.materials ?? {})) {
      const key = Material.target(target);
      materials[key] = new Material(input);
      previousMaterials[key] = app.styleManager.getMaterial(key);
    }
    if (
      change.bondColorMode !== undefined &&
      change.bondColorMode !== "split" &&
      change.bondColorMode !== "theme"
    )
      throw new Error("Invalid bond color mode");
    const outline = change.outline
      ? Settings.resolveEffects(change.outline, app.settings.getEffects())
      : undefined;
    this.next = {
      ...change,
      ...(change.representation
        ? { representation: new Representation(change.representation) }
        : {}),
      ...(change.materials ? { materials } : {}),
      ...(outline
        ? {
            outline: {
              outlineEnabled: outline.outlineEnabled,
              atomOutline: outline.atomOutline,
              bondOutline: outline.bondOutline,
            },
          }
        : {}),
    };
    const effects = change.outline ? app.settings.getEffects() : undefined;
    this.prev = {
      ...(change.representation
        ? { representation: app.styleManager.getRepresentation() }
        : {}),
      ...(change.materials ? { materials: previousMaterials } : {}),
      ...(change.bondColorMode !== undefined
        ? { bondColorMode: app.styleManager.getBondColorMode() }
        : {}),
      ...(effects
        ? {
            outline: {
              outlineEnabled: effects.outlineEnabled,
              atomOutline: effects.atomOutline,
              bondOutline: effects.bondOutline,
            },
          }
        : {}),
    };
  }

  async do(): Promise<void> {
    await this.apply(this.next, this.prev);
  }
  async undo(): Promise<void> {
    await this.apply(this.prev, this.next);
  }

  private write(change: VisualStyleChange): void {
    if (change.representation)
      this.app.styleManager.setRepresentation(change.representation);
    for (const [target, value] of Object.entries(change.materials ?? {}))
      this.app.styleManager.setMaterial(Material.target(target), value);
    if (change.bondColorMode !== undefined)
      this.app.styleManager.setBondColorMode(change.bondColorMode);
    if (change.outline) this.app.settings.setEffects(change.outline);
  }

  private async redraw(change: VisualStyleChange): Promise<void> {
    if (change.representation || change.bondColorMode !== undefined) {
      if (this.app.frame) await this.app.applyPipeline({ fullRebuild: true });
      else this.app.artist.redrawFromSceneIndex();
    }
    this.app.world.renderOnce();
  }

  private async apply(
    next: VisualStyleChange,
    previous: VisualStyleChange,
  ): Promise<void> {
    try {
      this.write(next);
      await this.redraw(next);
    } catch (error) {
      this.write(previous);
      try {
        await this.redraw(previous);
      } catch (recovery) {
        throw new AggregateError(
          [error, recovery],
          "Visual style update and redraw recovery failed",
        );
      }
      throw error;
    }
    if (next.representation)
      this.app.events.emit(
        "representation-change",
        this.app.styleManager.getRepresentation(),
      );
    if (next.materials)
      this.app.events.emit("material-change", {
        atom: this.app.styleManager.getMaterial("atom"),
        bond: this.app.styleManager.getMaterial("bond"),
      });
    if (next.bondColorMode !== undefined)
      this.app.events.emit("coloring-change", undefined);
  }
}
