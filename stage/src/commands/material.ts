import type { MolvisApp } from "../app";
import {
  Material,
  type MaterialInput,
  type MaterialStyle,
  type MaterialTarget,
} from "../artist/material";
import { Command } from "./base";

/** Uniform-only surface edit: never touches geometry, colors or SceneIndex. */
export class SetMaterialCommand extends Command<MaterialStyle> {
  private readonly target: MaterialTarget;
  private readonly next: MaterialStyle;
  private readonly prev: MaterialStyle;

  constructor(app: MolvisApp, target: MaterialTarget, input: MaterialInput) {
    super(app);
    this.target = Material.target(target);
    this.next = new Material(input);
    this.prev = app.styleManager.getMaterial(this.target);
  }

  do(): MaterialStyle {
    this.apply(this.next);
    return this.next;
  }
  undo(): void {
    this.apply(this.prev);
  }

  private apply(value: MaterialStyle): void {
    const previous = this.app.styleManager.getMaterial(this.target);
    this.app.styleManager.setMaterial(this.target, value);
    try {
      this.app.world.renderOnce();
    } catch (error) {
      this.app.styleManager.setMaterial(this.target, previous);
      try {
        this.app.world.renderOnce();
      } catch (recovery) {
        throw new AggregateError(
          [error, recovery],
          "Material update and recovery failed",
        );
      }
      throw error;
    }
    this.app.events.emit("material-change", {
      atom: this.app.styleManager.getMaterial("atom"),
      bond: this.app.styleManager.getMaterial("bond"),
    });
  }
}
