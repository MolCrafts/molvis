import { Frame } from "@molcrafts/molvis-core/molrs";
import type { System } from "../system";
import { Trajectory } from "../system/trajectory";
import { DataSource, MemoryDataSource } from "./data_source";
import type { ModifierPipeline } from "./pipeline";

/** Display name for the always-present empty primary data source. */
export const EMPTY_SCENE_FILENAME = "Empty Scene";

/**
 * # Single scene path (invariant)
 *
 * MolVis always has **exactly one logical scene identity**:
 *
 * 1. `System.trajectory` is non-empty (`length ≥ 1`). A single structure is
 *    a length-1 trajectory — never a parallel "no trajectory" mode.
 * 2. The modifier pipeline always has **≥ 1** {@link DataSource}
 *    at the composition head. On open / reset that primary is an empty
 *    {@link MemoryDataSource} ("Empty Scene").
 * 3. Every ingress (file load, sketch commit, RPC clear, manual box,
 *    wrap, …) mutates or replaces data **on that path**:
 *    `DataSource → compose → transforms → draws`. There is no second
 *    entry that paints meshes while bypassing the composition head.
 *
 * Load **replace** swaps the primary source's trajectory (still one
 * primary DS). Load **augment** adds further DataSources; the primary
 * slot never disappears. Removing the last DS reinstalls Empty Scene.
 */

/**
 * Build the boot/reset primary: length-1 empty frame as a memory source.
 */
export function createEmptyPrimaryDataSource(): MemoryDataSource {
  return new MemoryDataSource(new Frame(), {
    sourceType: "empty",
    filename: EMPTY_SCENE_FILENAME,
  });
}

/**
 * Install Empty Scene as the sole primary data source.
 *
 * - Clears the pipeline (caller must have reassigned `system.trajectory`
 *   away from any about-to-be-disposed shared trajectory, or pass
 *   `rebindSystem: true` so we install first then dispose old sources
 *   safely — this helper does the safe order).
 * - Binds `system.trajectory` to the new empty primary.
 * - Leaves Draw modifiers absent (empty frame has nothing to draw).
 */
export function installEmptyPrimaryScene(
  system: System,
  pipeline: ModifierPipeline,
): MemoryDataSource {
  // Detach System from any shared DS trajectory *before* dispose.
  const placeholder = new Trajectory([new Frame()]);
  system.trajectory = placeholder;

  pipeline.clear();

  const primary = createEmptyPrimaryDataSource();
  // Prefer the DS-owned trajectory as the system identity so commit/replace
  // on the primary stay coherent without a second copy.
  system.trajectory = primary.trajectory;
  pipeline.addSource(primary);
  // placeholder is orphaned (not disposed) — single empty Frame, GC-ok;
  // avoid free races if something still held a handle for a tick.
  return primary;
}

/**
 * The first enabled {@link DataSource} — the composition primary.
 * Under the single-path invariant this is always defined after boot.
 */
export function primaryDataSource(
  pipeline: ModifierPipeline,
): DataSource | undefined {
  return pipeline
    .sources()
    .find((m): m is DataSource => m instanceof DataSource && m.enabled);
}

/**
 * If the pipeline has no data source, install Empty Scene.
 * Idempotent when a primary already exists.
 */
export function ensurePrimaryDataSource(
  system: System,
  pipeline: ModifierPipeline,
): DataSource {
  const existing = primaryDataSource(pipeline);
  if (existing) return existing;
  return installEmptyPrimaryScene(system, pipeline);
}
