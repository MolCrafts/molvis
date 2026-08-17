import { Frame } from "@molcrafts/molvis-core/molrs";
import type { System } from "../system";
import { Trajectory } from "../system/trajectory";
import { DataSource, MemoryDataSource } from "./data_source";
import type { ModifierPipeline } from "./pipeline";

/**
 * Legacy label kept for project hydrate / old snapshots that still embed
 * an empty memory primary. New boots no longer auto-install this DS.
 */
export const EMPTY_SCENE_FILENAME = "Empty Scene";

/**
 * # Pipeline + system path
 *
 * 1. `System.trajectory` is always defined (length ≥ 1). A single structure is
 *    a length-1 trajectory — never a parallel "no trajectory" mode.
 * 2. The modifier pipeline may be **empty** at boot / after clear / after the
 *    last DataSource is removed. Composition with zero sources yields an empty
 *    Frame (`composeSources([])`).
 * 3. The user adds a **Source** ({@link FileDataSource} / stream / memory)
 *    via Open / Add source / Stream. Replace installs the primary; augment stacks.
 * 4. Ingress that needs a DS (sketch commit, optimize writeback) creates one
 *    when missing — it does **not** pre-install a ghost "Empty Scene" row.
 */

/**
 * Build an empty memory source (legacy helpers / optimize fallback).
 * Prefer not to put this on the pipeline at boot.
 */
export function createEmptyPrimaryDataSource(): MemoryDataSource {
  return new MemoryDataSource(new Frame(), {
    sourceType: "empty",
    filename: EMPTY_SCENE_FILENAME,
  });
}

/**
 * Clear the pipeline and give System a standalone empty length-1 trajectory.
 *
 * Does **not** add a DataSource row — the pipeline list starts empty so the
 * user can add a File Loader themselves.
 */
export function bootstrapEmptyPipeline(
  system: System,
  pipeline: ModifierPipeline,
): void {
  // Detach System from any shared DS trajectory *before* dispose.
  const standalone = new Trajectory([new Frame()]);
  system.trajectory = standalone;
  pipeline.clear();
}

/**
 * @deprecated Use {@link bootstrapEmptyPipeline}. Kept for call sites that
 * still say "empty primary"; behaviour is empty pipeline (no Empty Scene DS).
 */
export function installEmptyPrimaryScene(
  system: System,
  pipeline: ModifierPipeline,
): MemoryDataSource | undefined {
  bootstrapEmptyPipeline(system, pipeline);
  return undefined;
}

/**
 * The first enabled {@link DataSource} — the composition primary.
 * Undefined when the pipeline has no sources yet.
 */
export function primaryDataSource(
  pipeline: ModifierPipeline,
): DataSource | undefined {
  return pipeline
    .sources()
    .find((m): m is DataSource => m instanceof DataSource && m.enabled);
}

/**
 * Return the existing primary, or `undefined` if the pipeline has none.
 *
 * Does **not** auto-install Empty Scene — callers that need a DS must create
 * one explicitly (file load, sketch commit, optimize).
 */
export function ensurePrimaryDataSource(
  system: System,
  pipeline: ModifierPipeline,
): DataSource | undefined {
  void system;
  return primaryDataSource(pipeline);
}
