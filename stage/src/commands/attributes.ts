import type { MolvisApp } from "../app";
import { Command, command } from "./base";

export interface SetAttributeArgs {
  type: "atom" | "bond";
  ids: number[];
  key: string;
  value: unknown | Map<number, unknown>;
}

@command("set_attribute")
export class SetAttributeCommand extends Command<void> {
  private previousValues = new Map<number, unknown>();
  private executed = false;

  // Properties to hold args
  private type: "atom" | "bond";
  private ids: number[];
  private key: string;
  private value: unknown | Map<number, unknown>;

  constructor(app: MolvisApp, args: SetAttributeArgs) {
    super(app);
    this.type = args.type;
    this.ids = args.ids;
    this.key = args.key;
    this.value = args.value;
  }

  do(): void {
    const sceneIndex = this.app.world.sceneIndex;

    // Capture previous values if not already captured
    // We capture BEFORE modification.
    if (!this.executed) {
      for (const id of this.ids) {
        const prev = sceneIndex.getAttribute(this.type, id, this.key);
        this.previousValues.set(id, prev);
      }
    }

    // Apply new values
    const isMap = this.value instanceof Map;
    for (const id of this.ids) {
      const val = isMap
        ? (this.value as Map<number, unknown>).get(id)
        : this.value;
      // If internal map has no value for this ID, what do we do? skip?
      // If scalar, use scalar.
      if (isMap && !(this.value as Map<number, unknown>).has(id)) continue;

      sceneIndex.setAttribute(this.type, id, this.key, val);
    }

    this.executed = true;
  }

  undo(): Command {
    // Return inverse command
    // The inverse sets the attribute to `previousValues` map.
    return new SetAttributeCommand(this.app, {
      type: this.type,
      ids: this.ids,
      key: this.key,
      value: this.previousValues,
    });
  }
}
