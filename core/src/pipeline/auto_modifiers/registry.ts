import type { AutoAttachableModifier } from "./auto_modifier";
import { BackboneRibbonModifier } from "./backbone_ribbon";

/**
 * Static list of modifier classes that opt into auto-attachment.
 *
 * Each class declares its own attachment predicate via the static
 * {@link AutoAttachableModifier.matches} method. The streaming loader
 * walks this list against frame 0 and instantiates whatever matches.
 *
 * Adding a new auto-attaching modifier is a one-line append here —
 * no separate registration ceremony, no `register*` side-effects to
 * preserve through tree-shaking.
 */
export const AUTO_ATTACH_MODIFIERS: readonly AutoAttachableModifier[] = [
  BackboneRibbonModifier,
];
