import type { Modifier, PipelineEntry } from "@molcrafts/molvis-stage";
import type { ModifierPanelComponent } from "../types";
import { Emitter } from "./emitter";
import { ContributionStore } from "./store";

export type ModifierPanelMatcher = {
  id: string;
  match: (entry: PipelineEntry) => boolean;
  component: ModifierPanelComponent;
  /**
   * When true, selecting/adding this modifier opens the left advanced panel
   * for **compute** params (`surface="compute"`). The pipeline bottom pane
   * shows **draw** params (`surface="draw"`) instead of a dead stub.
   *
   * Use for analysis-nature / mesh-building modifiers only.
   */
  usesLeftConfig?: boolean;
};

const byTypeId = new ContributionStore<ModifierPanelComponent>();
const matchers: ModifierPanelMatcher[] = [];
const matcherEvents = new Emitter("modifier panel matcher");

function emitMatchers(): void {
  matcherEvents.emit();
}

/**
 * Register a property panel for modifiers whose `typeId` (or wrapped
 * plugin kind) equals `typeId`.
 */
export function registerModifierPanel(
  typeId: string,
  component: ModifierPanelComponent,
): () => void {
  return byTypeId.set(typeId, component);
}

/**
 * Register a predicate-based panel (used for built-ins with dynamic names).
 */
export function registerModifierPanelMatcher(
  matcher: ModifierPanelMatcher,
): () => void {
  matchers.push(matcher);
  emitMatchers();
  return () => {
    const idx = matchers.findIndex((m) => m.id === matcher.id);
    if (idx >= 0) {
      matchers.splice(idx, 1);
      emitMatchers();
    }
  };
}

/** Stable type id attached by the plugin API when registering modifiers. */
export const PLUGIN_MODIFIER_TYPE_ID = "__molvisPluginTypeId";

export function getModifierTypeId(modifier: PipelineEntry): string | undefined {
  const tagged = (
    modifier as Modifier & { [PLUGIN_MODIFIER_TYPE_ID]?: string }
  )[PLUGIN_MODIFIER_TYPE_ID];
  if (typeof tagged === "string" && tagged.length > 0) return tagged;
  return undefined;
}

export function resolveModifierPanel(
  modifier: PipelineEntry,
): ModifierPanelComponent | null {
  const typeId = getModifierTypeId(modifier);
  if (typeId) {
    const byId = byTypeId.get(typeId);
    if (byId) return byId;
  }
  // Prefer exact name match for plugins that set name === kind.
  const byName = byTypeId.get(modifier.name);
  if (byName) return byName;

  for (const matcher of matchers) {
    if (matcher.match(modifier)) return matcher.component;
  }
  return null;
}

/** True when the modifier should open the left dedicated config page. */
export function modifierUsesLeftConfig(modifier: PipelineEntry): boolean {
  for (const matcher of matchers) {
    if (matcher.usesLeftConfig && matcher.match(modifier)) return true;
  }
  return false;
}

export function subscribeModifierPanels(listener: () => void): () => void {
  const unsubscribeById = byTypeId.subscribe(listener);
  const unsubscribeMatchers = matcherEvents.subscribe(listener);
  return () => {
    unsubscribeById();
    unsubscribeMatchers();
  };
}
