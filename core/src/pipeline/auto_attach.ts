/**
 * Unified auto-attach: every registered modifier exposes an instance
 * `matches(frame)` predicate (default `false` from BaseModifier). When
 * a frame loads, walk the registry, instantiate a probe per entry,
 * and attach those whose `matches()` returns true.
 *
 * Replaces the old `AutoAttachableModifier` class-side contract +
 * separate `AUTO_ATTACH_MODIFIERS` registry. There is now one
 * registry, one predicate shape, one entry point.
 *
 * When a `parentDS` is provided (multi-data-source spec phase 2), each
 * attached modifier is reparented under that DS so the UI tree shows
 * Draws nested under the source they came from. The child–DS edge is
 * purely organizational; no selection scoping is implied.
 */

import type { Frame } from "@molcrafts/molrs";
import { logger } from "../utils/logger";
import type { DataSourceModifier } from "./data_source_modifier";
import type { Modifier } from "./modifier";
import { ModifierRegistry } from "./modifier_registry";
import type { ModifierPipeline } from "./pipeline";

/**
 * Walk the global modifier registry against `frame` (typically frame 0
 * of a freshly-loaded trajectory) and instantiate those whose
 * `matches(frame)` predicate returns true.
 *
 * Returns the list of registry entry names that were attached, so the
 * caller can persist this on the trajectory for UI / unload accounting.
 *
 * @param suppressedIds Registry entry names the user has explicitly
 *   removed in this session — skip them so reload doesn't resurrect.
 * @param parentDS If provided, attached modifiers are reparented under
 *   this DataSourceModifier (visual grouping in the pipeline tree).
 */
export function applyAutoAttach(
  pipeline: ModifierPipeline,
  frame: Frame,
  suppressedIds?: ReadonlySet<string>,
  parentDS?: DataSourceModifier,
): readonly string[] {
  // Ensure default modifiers (DataSource etc.) are registered before iterating.
  ModifierRegistry.initialize();

  const attached: string[] = [];
  for (const entry of ModifierRegistry.getAvailableModifiers()) {
    if (suppressedIds?.has(entry.name)) continue;

    const probe = entry.factory();
    if (!safeMatches(probe, frame, entry.name)) continue;

    pipeline.addModifier(probe);
    if (parentDS !== undefined) {
      // setParent's DS-as-parent branch (phase 2 of spec) — purely a
      // visual grouping edge, no selection semantics.
      const ok = pipeline.setParent(probe.id, parentDS.id);
      if (!ok) {
        logger.warn(
          `[auto-attach] failed to nest ${entry.name} under ${parentDS.filename || parentDS.id}`,
        );
      }
    }
    attached.push(entry.name);
    logger.info(`[auto-attach] attached ${entry.name}`);
  }
  return attached;
}

/** A misbehaving `matches()` that throws would otherwise abort the
 *  whole load path. Catch and log; treat the entry as a no-match. */
function safeMatches(probe: Modifier, frame: Frame, label: string): boolean {
  try {
    return probe.matches(frame);
  } catch (err) {
    logger.warn(`[auto-attach] ${label}.matches threw; skipping`, err as Error);
    return false;
  }
}
