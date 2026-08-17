import { DeleteSelectedModifier } from "../modifiers/DeleteSelectedModifier";
import { HideHydrogensModifier } from "../modifiers/HideHydrogensModifier";
import { HideSelectionModifier } from "../modifiers/HideSelectionModifier";
import { type Modifier, ModifierCapability } from "./modifier";

export const NATO_ALPHABET = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
  "India",
  "Juliet",
  "Kilo",
  "Lima",
  "Mike",
  "November",
  "Oscar",
  "Papa",
  "Quebec",
  "Romeo",
  "Sierra",
  "Tango",
  "Uniform",
  "Victor",
  "Whiskey",
  "X-ray",
  "Yankee",
  "Zulu",
] as const;

/**
 * Generate a unique NATO-alphabet-based ID.
 * Returns the first unused name from NATO_ALPHABET.
 * If all 26 are taken, appends -2, -3, etc.
 */
export function generateNatoId(existingIds: ReadonlySet<string>): string {
  // First pass: try each NATO name without suffix
  for (const name of NATO_ALPHABET) {
    if (!existingIds.has(name)) {
      return name;
    }
  }

  // All 26 taken — try suffixed variants
  let suffix = 2;
  while (true) {
    for (const name of NATO_ALPHABET) {
      const candidate = `${name}-${suffix}`;
      if (!existingIds.has(candidate)) {
        return candidate;
      }
    }
    suffix++;
  }
}

/**
 * Returns true if the modifier produces a named selection
 * (writes `context.currentSelection` / selectionCache entry).
 * Capability-based so Invert / Expand / Select Type / Select overlapping
 * participate in parent-scope chaining like Expression Select.
 */
export function isSelectionProducer(mod: Modifier): boolean {
  return mod.capabilities.has(ModifierCapability.ProducesSelection);
}

/**
 * Returns true if the modifier changes frame topology
 * (removes atoms/bonds, altering index mapping).
 */
export function isTopologyChanging(mod: Modifier): boolean {
  return (
    mod instanceof HideSelectionModifier ||
    mod instanceof DeleteSelectedModifier ||
    mod instanceof HideHydrogensModifier
  );
}
