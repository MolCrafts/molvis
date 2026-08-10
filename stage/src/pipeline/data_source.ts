import type { Box, Frame } from "@molcrafts/molvis-core/molrs";
import { frameToTrajectory, type Trajectory } from "../system/trajectory";
import type { PipelineEntry } from "./entry";

/**
 * Discriminator for a {@link DataSource}'s **acquisition** method — where its
 * data comes from, not what shape it has (every source exposes a unified
 * {@link Trajectory}; a single frame is a length-1 trajectory).
 *
 * - `file` — backed by a parsed / lazy / streaming {@link Trajectory}
 *   ({@link FileDataSource}).
 * - `memory` — an in-memory single {@link Frame} wrapped as a length-1
 *   trajectory ({@link MemoryDataSource}); broadcasts across the timeline.
 * - `stream` — a trajectory that grows from a live socket
 *   ({@link StreamDataSource}).
 *
 * This union previously also carried `ssh` and `http` as reserved kinds with
 * no subclass behind them. They were deleted rather than implemented: neither
 * described an acquisition this class hierarchy does not already cover.
 * Fetching a remote file yields a `Trajectory` like any other, and
 * {@link FileDataSource} accepts any trajectory whatever built it — so `http`
 * was a transport detail masquerading as a kind. Add a member here only
 * alongside the subclass that answers to it.
 */
export type DataSourceKind = "file" | "memory" | "stream";

/**
 * Category label shared by all {@link DataSource} subclasses. Used as a stable
 * discriminator in serialized pipeline snapshots (see
 * `BackendStateSyncPipelineEntry`) — never use this string to branch on
 * behaviour; check `instanceof DataSource` or the `kind` field instead.
 */
export const DATA_SOURCE_CATEGORY = "Data Source";

/**
 * A source of scene data attached to the pipeline.
 *
 * Each DataSource OWNS its own {@link Trajectory} (never shared with another
 * source, never mutated in place by a common holder) and contributes it to the
 * source-composition step at the head of `ModifierPipeline.compute` (see
 * `system/source_composition.ts`).
 *
 * A source is **not** a {@link Modifier} — it contributes data rather than
 * transforming it, so it has no `apply()`, no capabilities, no selection
 * scope, and no meaningful position in the execution order. It shares only
 * {@link PipelineEntry}: an id, a name, and an enable switch. Disabling one
 * withholds its trajectory from composition.
 *
 * Concrete implementations: {@link FileDataSource} (parsed/streamed
 * trajectory), {@link MemoryDataSource} (a single in-memory frame).
 */
export abstract class DataSource implements PipelineEntry {
  /** Acquisition discriminator. See {@link DataSourceKind}. */
  abstract readonly kind: DataSourceKind;

  /** Whether this source contributes to composition. */
  public enabled = true;

  /** Provenance: where the data came from. */
  public sourceType: "file" | "empty" | "backend" = "empty";

  /** Display label (file name / "backend session" / etc.). */
  public filename = "";

  /**
   * Optional narrowing filter for the composition step. Empty (the default)
   * means "every block present on the source frame is contributed". Populate
   * to restrict to a subset, e.g. `["bonds"]` for a topology-only file.
   */
  public contributedBlocks: ReadonlyArray<string> = [];

  protected constructor(
    public readonly id: string,
    protected readonly _name: string,
  ) {}

  /** Human-readable name for UI display. */
  get name(): string {
    return this._name;
  }

  /**
   * The trajectory this source owns — the unified payload the composition step
   * reads. A single-frame source returns a length-1 trajectory.
   */
  abstract get trajectory(): Trajectory;

  /** Number of frames this source provides (= `trajectory.length`). */
  abstract get frameCount(): number;

  /**
   * Resolve the contributing frame for the given timeline index. A length-1
   * (memory) source returns its single frame regardless of `index`
   * (broadcast). May be async for streamed sources — await before reading.
   */
  abstract getFrame(index: number): Promise<Frame> | Frame;

  /** Pre-load the frame at `index` into a synchronous cache. Throws if out of range. */
  abstract preload(index: number): Promise<void>;

  /** Sync access to the most recently preloaded frame. Throws if `preload()` not called. */
  abstract get cachedFrame(): Frame;

  /** Best-effort sync access; returns `undefined` before the first `preload()`. */
  abstract get peekFrame(): Frame | undefined;

  /**
   * Replace the frame at the head of this source's trajectory (index 0) with
   * an edited one, attaching `box` as that slot's cell.
   *
   * The seat for in-place scene edits that produce a new HEAD — structure
   * optimize, sketch commit. Callers must **not** reach into
   * `source.trajectory` and call `replaceFrame` themselves: only the source
   * knows whether its data is editable at all, and only it can keep the frame
   * and the per-frame box slot in step.
   *
   * Implementations that cannot accept an edited HEAD (a file on disk, a live
   * socket) **throw** — a silent no-op would drop the edit on the floor.
   *
   * The source takes ownership of `frame`; the previous HEAD is released to
   * GC, never explicitly freed (other layers may still read it for a tick).
   */
  abstract replaceHeadFrame(frame: Frame, box?: Box): void;

  /**
   * Free WASM resources.
   *
   * Deliberately **not** wired to {@link PipelineEntry.onRemoved}: removal has
   * to re-point `System` at a surviving trajectory *before* the outgoing one is
   * freed, or live UI listeners read a dangling frame ("null pointer passed to
   * rust"). `SceneSession.removeDataSource` owns that ordering and calls this
   * explicitly once it is safe. See its doc comment.
   */
  abstract dispose(): void;
}

/** Optional fields shared by the concrete data sources. */
export interface DataSourceOptions {
  filename?: string;
  sourceType?: DataSource["sourceType"];
  contributedBlocks?: ReadonlyArray<string>;
}

function applyOptions(ds: DataSource, options: DataSourceOptions): void {
  if (options.filename !== undefined) ds.filename = options.filename;
  if (options.sourceType !== undefined) ds.sourceType = options.sourceType;
  if (options.contributedBlocks !== undefined) {
    ds.contributedBlocks = options.contributedBlocks;
  }
}

/**
 * A data source acquired from a parsed file — backed by a multi-frame
 * {@link Trajectory}. `getFrame(i)` returns the i-th frame; both eager and
 * async-streaming trajectories work through `Trajectory.frame(i)`. The
 * trajectory is consulted lazily — constructing the source pulls no frames.
 */
export class FileDataSource extends DataSource {
  readonly kind = "file" as const;

  private readonly _trajectory: Trajectory;
  private _cached: Frame | null = null;

  constructor(trajectory: Trajectory, options: DataSourceOptions = {}) {
    super("file-data-source", "File Loader");
    this._trajectory = trajectory;
    applyOptions(this, options);
  }

  get trajectory(): Trajectory {
    return this._trajectory;
  }

  get frameCount(): number {
    return this._trajectory.length;
  }

  async getFrame(index: number): Promise<Frame> {
    return this._trajectory.frame(index);
  }

  async preload(index: number): Promise<void> {
    if (index < 0 || index >= this._trajectory.length) {
      throw new Error(
        `FileDataSource ${this.id}: frame index ${index} out of range [0, ${this._trajectory.length})`,
      );
    }
    this._cached = await this._trajectory.frame(index);
  }

  get cachedFrame(): Frame {
    if (this._cached === null) {
      throw new Error(
        `FileDataSource ${this.id}: cachedFrame accessed before preload()`,
      );
    }
    return this._cached;
  }

  get peekFrame(): Frame | undefined {
    if (this._cached) return this._cached;
    // Eager / already-materialized trajectories expose frame 0 without
    // preload — UI stats and auto-attach must not depend on a side-effect
    // cache that replaceScene historically forgot to warm.
    try {
      return this._trajectory.get(0) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Always throws. A file source mirrors bytes that were parsed from disk;
   * writing an edited frame back into it would make the pipeline disagree with
   * its own provenance. Load the edit into a {@link MemoryDataSource} instead.
   */
  replaceHeadFrame(_frame: Frame, _box?: Box): never {
    throw new Error(
      `FileDataSource ${this.id}: optimize writeback requires an editable ` +
        `source; '${this.filename || "file"}' is read-only.`,
    );
  }

  dispose(): void {
    this._trajectory.dispose();
    this._cached = null;
  }
}

/**
 * A data source carrying a single in-memory {@link Frame}, wrapped as a
 * length-1 {@link Trajectory} via {@link frameToTrajectory}. `getFrame(_)`
 * returns the same frame regardless of index — composition broadcasts
 * it across the timeline when combined with longer sources.
 */
export class MemoryDataSource extends DataSource {
  readonly kind = "memory" as const;

  private readonly _frame: Frame;
  private readonly _trajectory: Trajectory;
  /** Set by {@link dispose}; accessors must not touch freed WASM. */
  private _disposed = false;

  constructor(frame: Frame, options: DataSourceOptions = {}) {
    super("memory-data-source", "Memory Source");
    this._frame = frame;
    this._trajectory = frameToTrajectory(frame);
    applyOptions(this, options);
  }

  /**
   * The wrapped single frame. Prefer the trajectory slot so callers that
   * share this trajectory with {@link System} (e.g. sketch save) stay
   * coherent after `updateCurrentFrame` replaces index 0.
   *
   * Throws after {@link dispose} — UI panels should use {@link peekFrame},
   * which returns `undefined` instead of a freed WASM pointer.
   */
  get frame(): Frame {
    if (this._disposed) {
      throw new Error("MemoryDataSource: frame accessed after dispose()");
    }
    return this._trajectory.get(0) ?? this._frame;
  }

  get trajectory(): Trajectory {
    return this._trajectory;
  }

  get frameCount(): number {
    return 1;
  }

  getFrame(_index: number): Frame {
    // Index ignored: a memory source broadcasts its single frame.
    return this.frame;
  }

  async preload(_index: number): Promise<void> {
    // No-op — the frame is already in memory.
  }

  get cachedFrame(): Frame {
    return this.frame;
  }

  /**
   * Best-effort sync access. Returns `undefined` after {@link dispose} so
   * React panels that still hold the source (until pipeline-cleared
   * re-renders) do not call into a freed Frame and throw
   * "null pointer passed to rust".
   */
  get peekFrame(): Frame | undefined {
    if (this._disposed) return undefined;
    return this.frame;
  }

  /**
   * Swap the single in-memory frame (and its cell) for an edited one. The
   * trajectory slot is the source of truth — {@link frame} reads it — so
   * `_frame` stays only as the pre-edit fallback.
   */
  replaceHeadFrame(frame: Frame, box?: Box): void {
    if (this._disposed) {
      throw new Error("MemoryDataSource: replaceHeadFrame after dispose()");
    }
    this._trajectory.replaceFrame(0, frame, box);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    // Frees the frame in the trajectory (same object as `_frame`).
    // Callers that shared this trajectory with System must reassign
    // system.trajectory *before* dispose (see MolvisApp.reset).
    this._trajectory.dispose();
  }
}
