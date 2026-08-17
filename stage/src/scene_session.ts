import type { Box, Frame } from "@molcrafts/molvis-core/molrs";
import type { Artist } from "./artist";
import type { CommandManager } from "./commands/manager";
import type { ModifierPipeline } from "./pipeline";
import { applyAutoAttach } from "./pipeline/auto_attach";
import {
  DataSource,
  type DataSourceOptions,
  FileDataSource,
} from "./pipeline/data_source";
import {
  bootstrapEmptyPipeline,
  ensurePrimaryDataSource,
  primaryDataSource,
} from "./pipeline/empty_scene";
import type { System } from "./system";
import { Trajectory } from "./system/trajectory";

/**
 * Host surface needed by {@link SceneSession} to orchestrate scene loads
 * without owning the full {@link MolvisApp} façade.
 */
export interface SceneSessionHost {
  readonly artist: Artist;
  readonly commandManager: CommandManager;
  readonly pipeline: ModifierPipeline;
  readonly system: System;
  isRunning(): boolean;
  setFrameIndex(index: number): void;
  clearLastRenderedFrame(): void;
  renderActiveTrajectoryFrame(forceFull: boolean): Promise<void>;
  applyPipeline(opts: { fullRebuild: boolean }): Promise<Frame | null>;
}

/**
 * Scene / data-source orchestration extracted from {@link MolvisApp}.
 * Public app methods remain thin delegates for API stability.
 */
export class SceneSession {
  constructor(private readonly host: SceneSessionHost) {}

  /**
   * Boot / hard-reset path: empty pipeline, standalone empty system
   * trajectory. User adds a Source via Open / Stream.
   */
  bootstrapEmptyPrimary(): void {
    bootstrapEmptyPipeline(this.host.system, this.host.pipeline);
    this.host.setFrameIndex(this.host.system.trajectory.currentIndex);
    this.host.clearLastRenderedFrame();
  }

  /**
   * Replace the whole scene with a single source trajectory.
   *
   * Clears prior sources/modifiers, installs one primary {@link FileDataSource}
   * (`name` "Source") that owns `trajectory`, and binds System to the same
   * trajectory.
   *
   * Auto-attaches default Draw modifiers (Particles / Bonds / Box / …)
   * from frame 0 so file load / set_trajectory actually paint meshes.
   * RPC progressive draws (`scene.draw_atom` / `draw_frame`) go through
   * Edit commands (working tree) and only hit HEAD on `scene.commit`.
   *
   * Emits 'trajectory-change' through System.
   */
  async replaceScene(
    trajectory: Trajectory,
    meta?: DataSourceOptions,
  ): Promise<void> {
    this.host.artist.clear();
    this.host.commandManager.clearHistory();

    // Point System at the incoming trajectory *before* disposing pipeline
    // sources. After sketch/edit save, System may share a MemoryDataSource
    // trajectory; clearing first would free system.frame under active UI
    // listeners (null pointer passed to rust).
    await this.host.system.setTrajectory(trajectory);
    this.host.setFrameIndex(this.host.system.trajectory.currentIndex);
    this.host.clearLastRenderedFrame();

    this.host.pipeline.clear();
    // File load and memory/RPC replace use FileDataSource as the primary
    // Source when the payload is an owned Trajectory.
    const newDS = new FileDataSource(trajectory, meta);
    this.host.pipeline.addSource(newDS);
    // Safety: primary should exist after we just added it.
    ensurePrimaryDataSource(this.host.system, this.host.pipeline);

    // Warm the DS cache so peekFrame / cachedFrame work for panels and
    // auto-attach without relying solely on System.frame.
    await newDS.preload(0);

    // Nest Draws under the primary DS (same as addDataSource / file load).
    const frame0 = newDS.cachedFrame ?? this.host.system.frame;
    if (frame0) {
      applyAutoAttach(this.host.pipeline, frame0, undefined, newDS);
    }

    if (this.host.isRunning()) {
      await this.host.renderActiveTrajectoryFrame(true);
    }
  }

  /**
   * Append one frame to the end of the live scene.
   *
   * The streaming counterpart to {@link replaceScene}: the primary source
   * grows by one frame, the pipeline is not rebuilt, and the camera is not
   * moved. Returns the new frame's index and whether the scene had to be
   * installed first — the caller decides what to do about that (typically
   * frame the camera once, on the frame that created the scene).
   *
   * A scene whose primary is not a trajectory-owning {@link FileDataSource}
   * cannot be appended to. That covers boot's empty pipeline, sketch/edit
   * {@link MemoryDataSource} rows (broadcast `getFrame`), and when System
   * points at a different trajectory than the primary owns. The first append
   * then replaces the scene with a length-1 Source; later appends grow it.
   */
  async appendFrame(
    frame: Frame,
    box?: Box,
    meta?: DataSourceOptions,
  ): Promise<{ index: number; installedScene: boolean }> {
    const primary = primaryDataSource(this.host.pipeline);
    const appendable =
      primary instanceof FileDataSource &&
      primary.trajectory === this.host.system.trajectory;

    if (!appendable) {
      await this.replaceScene(new Trajectory([frame], [box]), meta);
      return { index: 0, installedScene: true };
    }

    return {
      index: this.host.system.appendFrame(frame, box),
      installedScene: false,
    };
  }

  /**
   * Append an *additional* {@link DataSource} to the pipeline (vs.
   * replaceScene, which replaces the primary source). The composition head
   * merges every enabled source at compute time.
   *
   * - Frame-count compatibility is NOT hard-checked: the composition head
   *   reconciles per-source counts at compute time (length-1 broadcast /
   *   equal-length zip / unequal>1 error with a concrete message).
   * - Auto-attach runs against this DS's frame 0 so default Draw modifiers
   *   (DrawAtom / DrawBond / DrawBox) get installed for the block kinds the
   *   source contributes.
   * - If this is the *first* FileDataSource in the pipeline, System adopts
   *   its trajectory so navigation, frame-change events, and the seek state
   *   machine keep working.
   */
  async addDataSource(ds: DataSource): Promise<void> {
    this.host.pipeline.addSource(ds);

    // If this is the first FileDataSource, promote System to follow it.
    // Earlier MemoryDataSources stay in place and broadcast across the
    // newly grown timeline (their `getFrame(_)` ignores the index).
    if (ds instanceof FileDataSource) {
      const trajDSs = this.host.pipeline
        .sources()
        .filter((m): m is FileDataSource => m instanceof FileDataSource);
      const isFirstTraj = trajDSs.length === 1;
      if (isFirstTraj) {
        await this.host.system.setTrajectory(ds.trajectory);
        this.host.setFrameIndex(this.host.system.trajectory.currentIndex);
        this.host.clearLastRenderedFrame();
      }
    }

    // Auto-attach Draw modifiers based on what this DS contributes.
    // Pre-load frame 0 so matches() can introspect the source frame.
    // Pass the DS as source owner so the new Draws nest under it in the UI.
    // tree (purely organizational nesting — no
    // selection semantics).
    await ds.preload(0);
    applyAutoAttach(this.host.pipeline, ds.cachedFrame, undefined, ds);

    if (this.host.isRunning()) {
      await this.host.applyPipeline({ fullRebuild: true });
    }
  }

  /**
   * Remove a {@link DataSource} from the pipeline. Cascades through
   * children (Draw modifiers nested under this DS) via the existing
   * {@link ModifierPipeline.removeModifier} semantics. Disposes the DS's WASM
   * resources. Removing a FileDataSource:
   * - If another FileDataSource remains, System adopts its
   *   trajectory; the system's frame count tracks that new primary.
   * - If none remain, System collapses to a single empty frame so
   *   navigation state stays well-defined (the composition head still
   *   produces an empty Frame from the remaining sources).
   *
   * Throws if `id` does not refer to a DataSource in the
   * pipeline. Use {@link ModifierPipeline.removeModifier} directly for
   * non-DS modifiers (Select / Hide / Color / Draws / etc.).
   */
  async removeDataSource(id: string): Promise<void> {
    const target = this.host.pipeline
      .sources()
      .find((m): m is DataSource => m.id === id && m instanceof DataSource);
    if (!target) {
      throw new Error(`No DataSource with id '${id}' in pipeline`);
    }

    // Re-derive system trajectory *before* dispose when System currently
    // shares this DS's trajectory (sketch/edit Empty Scene MemoryDataSource,
    // or the primary FileDataSource). Disposing first frees system.frame and
    // UI listeners that re-read it throw "null pointer passed to rust".
    const remainingSources = this.host.pipeline
      .sources()
      .filter((m): m is DataSource => m instanceof DataSource && m.id !== id);
    const systemSharedTrajectory =
      this.host.system.trajectory === target.trajectory;
    const needsSystemReassign =
      systemSharedTrajectory || target instanceof FileDataSource;

    if (remainingSources.length === 0) {
      // Empty pipeline is allowed: clear list + standalone empty trajectory.
      this.host.artist.clear();
      this.host.commandManager.clearHistory();
      this.bootstrapEmptyPrimary();
      if (this.host.isRunning()) {
        await this.host.applyPipeline({ fullRebuild: true });
      }
      return;
    }

    if (needsSystemReassign) {
      const remainingFile = remainingSources.find(
        (m): m is FileDataSource => m instanceof FileDataSource,
      );
      const next = remainingFile ?? remainingSources[0];
      await this.host.system.setTrajectory(next.trajectory);
      this.host.setFrameIndex(this.host.system.trajectory.currentIndex);
      this.host.clearLastRenderedFrame();
    }

    const removed = this.host.pipeline.removeEntry(id);
    for (const m of removed) {
      if (m instanceof DataSource) m.dispose();
    }

    // Wipe GPU state before re-running so buffers from the removed source
    // cannot survive when composition no longer contributes those atoms.
    this.host.artist.clear();

    if (this.host.isRunning()) {
      await this.host.applyPipeline({ fullRebuild: true });
    }
  }
}
