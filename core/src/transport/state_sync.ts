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
 *
 * Multi-data-source spec phase 4: backend snapshots can carry multiple
 * DataSource entries. The first DS adopts the snapshot's `frames`
 * array as its trajectory data (primary `FileDataSource`).
 * Subsequent DS entries are restored as empty `MemoryDataSource`
 * placeholders — actual file data does not survive the snapshot
 * format, so the user re-attaches files after restore.
 */

import { Frame } from "@molcrafts/molrs";
import type { MolvisApp } from "../app";
import type {
  BackendStateSync,
  BackendStateSyncPipelineEntry,
} from "../events";
import {
  DataSourceModifier,
  MemoryDataSource,
} from "../pipeline/data_source_modifier";
import type { Modifier } from "../pipeline/modifier";
import {
  type ModifierFactory,
  ModifierRegistry,
} from "../pipeline/modifier_registry";
import { Trajectory } from "../system/trajectory";

/**
 * Identify a serialized pipeline entry as a DataSource. Uses the `kind`
 * field (present only on DataSource entries) as the primary discriminator,
 * with a fallback to the legacy `"Data Source"` name for backward
 * compatibility with Python backends that predate the rename.
 */
function isDataSourceEntry(e: BackendStateSyncPipelineEntry): boolean {
  return e.kind !== undefined || e.name === "Data Source";
}

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

  const dsEntries = state.pipeline.filter((e) => isDataSourceEntry(e));
  const nonDsEntries = state.pipeline.filter((e) => !isDataSourceEntry(e));

  // Replay frames into the FIRST DataSource entry, if any. Subsequent
  // DS entries are restored as empty MemoryDataSource placeholders so
  // the pipeline order matches the snapshot — the user re-attaches
  // their files after restore (the snapshot format intentionally does
  // not embed N×file payloads).
  const idMap = new Map<string, string>();
  if (dsEntries.length > 0 && state.frames.length > 0) {
    await app.setTrajectory(new Trajectory(state.frames, state.boxes), {
      sourceType: dsEntries[0].source_type ?? "backend",
      filename: dsEntries[0].filename ?? "backend-sync",
    });

    const head = app.modifierPipeline
      .getModifiers()
      .find((m): m is DataSourceModifier => m instanceof DataSourceModifier);
    if (head) {
      idMap.set(dsEntries[0].id, head.id);
      if (dsEntries[0].contributed_blocks) {
        head.contributedBlocks = [...dsEntries[0].contributed_blocks];
      }
    }
  }

  // Append placeholder MemoryDataSources for the remaining DS entries.
  // They contribute nothing (empty frame) until the user re-loads
  // their corresponding files via the UI's "Add Data Source" button
  // or RPC `scene.add_data_source`.
  for (let i = 1; i < dsEntries.length; i++) {
    const entry = dsEntries[i];
    const placeholder = new MemoryDataSource(new Frame(), {
      sourceType: entry.source_type ?? "empty",
      filename: entry.filename ?? "",
      contributedBlocks: entry.contributed_blocks ?? [],
    });
    await app.addDataSource(placeholder);
    idMap.set(entry.id, placeholder.id);
  }

  // Rebuild non-DataSource modifiers in the order given. Track old-id → new-id
  // so selection scopes and source ownership survive the replay.
  const registry = new Map<string, ModifierFactory>();
  for (const entry of ModifierRegistry.getAvailableModifiers()) {
    registry.set(entry.name, entry.factory);
  }

  for (const entry of nonDsEntries) {
    const factory = registry.get(entry.name);
    if (!factory) {
      console.warn(
        `[molvis] backend-state-sync: no factory for modifier "${entry.name}" — skipping`,
      );
      continue;
    }
    const modifier: Modifier = factory();
    modifier.enabled = entry.enabled;
    if (entry.selection_scope_id) {
      modifier.selectionScopeId =
        idMap.get(entry.selection_scope_id) ?? entry.selection_scope_id;
    }
    if (entry.source_owner_id) {
      modifier.sourceOwnerId =
        idMap.get(entry.source_owner_id) ?? entry.source_owner_id;
    }
    app.modifierPipeline.addModifier(modifier);
    idMap.set(entry.id, modifier.id);
  }

  await app.applyPipeline({ fullRebuild: true });
}
