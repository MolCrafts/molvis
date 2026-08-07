/**
 * Default visual layers for a loaded file.
 *
 * When a frame loads, walk the registry and attach every modifier with
 * `matches(frame) === true`. Those steps sit **under the file loader**
 * (`sourceOwner`) next to Particles / Ribbon / Simulation cell, default
 * **on** — the user unchecks what they do not want.
 *
 * **`matches` = auto-attach (default visual). Not "user may add".**
 * Analysis / opt-in viz (Steinhardt, Solid-liquid, Gaussian density, …)
 * keep `matches() === false` and use `isApplicable` for the Add menu.
 * Only true default layers (Particles, Ribbon, Bonds, Simulation cell,
 * Create isosurface when a grid is present) return true from `matches`.
 */

import type { Frame } from "@molcrafts/molvis-core/molrs";
import { logger } from "../utils/logger";
import type { DataSource } from "./data_source";
import { DrawBoxModifier, defaultSimulationCellEnabled } from "./draw_box";
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
 * @param sourceOwner If provided, attached modifiers are owned under
 *   this DataSource (visual grouping in the pipeline tree).
 */
export function applyAutoAttach(
  pipeline: ModifierPipeline,
  frame: Frame,
  suppressedIds?: ReadonlySet<string>,
  sourceOwner?: DataSource,
): readonly string[] {
  // Ensure default modifiers (DataSource etc.) are registered before iterating.
  ModifierRegistry.initialize();

  // Idempotent: file load / renderer / replaceScene may all call this on the
  // same pipeline. Skip registry names already present so we never stack a
  // second Particles / Bonds layer.
  const present = new Set(pipeline.modifiers().map((m) => m.name));

  const attached: string[] = [];
  for (const entry of ModifierRegistry.getAvailableModifiers()) {
    if (suppressedIds?.has(entry.name)) continue;
    if (present.has(entry.name)) continue;

    const probe = entry.factory();
    if (!safeMatches(probe, frame, entry.name)) continue;

    // Simulation cell: still attach under the file loader, but start
    // disabled when the cell is a placeholder (1×1×1) so the checkbox
    // is off and apply/applyVisibility use the same path as a user
    // uncheck — not a separate "draw skip" branch inside apply().
    if (probe instanceof DrawBoxModifier) {
      probe.enabled = defaultSimulationCellEnabled(frame);
    }

    pipeline.addModifier(probe);
    present.add(entry.name);
    if (sourceOwner !== undefined) {
      const ok = pipeline.setSourceOwner(probe.id, sourceOwner.id);
      if (!ok) {
        logger.warn(
          `[auto-attach] failed to nest ${entry.name} under ${sourceOwner.filename || sourceOwner.id}`,
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
