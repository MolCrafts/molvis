/**
 * Apply a snapshot received from the Python controller onto the local
 * :class:`MolvisApp`.
 *
 * Called after the user confirms "use backend" in the conflict dialog
 * (or automatically when the local pipeline is empty). Rebuilds the
 * pipeline in the order provided, re-using the registry's default
 * factory for each modifier type — v1 does not sync per-modifier
 * parameters, so Expression-type filters come back with their default
 * expression and similar.
 */

import type { MolvisApp } from "../app";
import type { BackendStateSync } from "../events";
import { DataSourceModifier } from "../pipeline/data_source_modifier";
import type { Modifier } from "../pipeline/modifier";
import {
  type ModifierFactory,
  ModifierRegistry,
} from "../pipeline/modifier_registry";
import { Trajectory } from "../system/trajectory";
import { ensureDataSource } from "./rpc/router";

/**
 * Replace the current pipeline with ``state``. Safe to call repeatedly —
 * the existing pipeline is cleared first so there is no merge/append
 * ambiguity.
 */
export async function applyBackendState(
  app: MolvisApp,
  state: BackendStateSync,
): Promise<void> {
  // Clear existing pipeline (frames + modifiers) before replay.
  app.modifierPipeline.clear();

  // Replay frames and install the head DataSourceModifier. Skip the
  // per-ingest applyPipeline + resetCamera — we rebuild the rest of the
  // pipeline below and apply once at the end.
  if (state.frames.length > 0) {
    ensureDataSource(app, {
      sourceType: "backend",
      filename: "backend-sync",
    });
    await app.setTrajectory(new Trajectory(state.frames, state.boxes));
  }

  // Rebuild non-DataSource modifiers in the order given. Track
  // old-id → new-id so parent references survive the replay.
  const registry = new Map<string, ModifierFactory>();
  for (const entry of ModifierRegistry.getAvailableModifiers()) {
    registry.set(entry.name, entry.factory);
  }

  const idMap = new Map<string, string>();
  for (const entry of state.pipeline) {
    if (entry.name === "Data Source") {
      // Already added by ingestFramesIntoPipeline above — map id for
      // downstream parent references.
      const head = app.modifierPipeline
        .getModifiers()
        .find((m): m is DataSourceModifier => m instanceof DataSourceModifier);
      if (head) {
        idMap.set(entry.id, head.id);
      }
      continue;
    }

    const factory = registry.get(entry.name);
    if (!factory) {
      console.warn(
        `[molvis] backend-state-sync: no factory for modifier "${entry.name}" — skipping`,
      );
      continue;
    }
    const modifier: Modifier = factory();
    modifier.enabled = entry.enabled;
    if (entry.parent_id) {
      modifier.parentId = idMap.get(entry.parent_id) ?? entry.parent_id;
    }
    app.modifierPipeline.addModifier(modifier);
    idMap.set(entry.id, modifier.id);
  }

  await app.applyPipeline({ fullRebuild: true });
}
