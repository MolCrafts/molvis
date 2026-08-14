import { defineMolvisElementPicker } from "@molcrafts/molvis-core/element-picker";

/** Register the edit-mode `<molvis-element-picker>` custom element. */
export function registerEditElementPicker(): void {
  defineMolvisElementPicker();
}

registerEditElementPicker();
