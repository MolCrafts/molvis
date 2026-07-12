import type { Frame } from "@molcrafts/molrs";
import { frameToTrajectory, type Trajectory } from "../system/trajectory";
import { BaseModifier, ModifierCapability } from "./modifier";
import type { PipelineContext } from "./types";

/**
 * Discriminator for a {@link DataSourceModifier}'s **acquisition** method —
 * where its data comes from, not what shape it has (every source now exposes a
 * unified {@link Trajectory}; a single frame is a length-1 trajectory).
 *
 * - `file` — backed by a parsed file / lazy / streaming {@link Trajectory}
 *   ({@link FileDataSource}).
 * - `memory` — an in-memory single {@link Frame} wrapped as a length-1
 *   trajectory ({@link MemoryDataSource}); broadcasts across the timeline.
 * - `ssh` / `http` — reserved acquisition kinds (no concrete subclass yet).
 */
export type DataSourceKind = "file" | "memory" | "ssh" | "http";

/**
 * Category label shared by all {@link DataSourceModifier} subclasses.
 * Used as a stable discriminator in serialized pipeline snapshots
 * (see {@link BackendStateSyncPipelineEntry}) — never use this string
 * to branch on modifier behaviour; check `instanceof DataSourceModifier`
 * or the `kind` field instead.
 */
export const DATA_SOURCE_CATEGORY = "Data Source";

/**
 * A data source attached to the pipeline. Each DataSourceModifier OWNS its own
 * {@link Trajectory} (never shared with another source, never mutated in place
 * by a common holder) and contributes it to the source-composition step at the
 * head of `ModifierPipeline.compute` (see `system/source_composition.ts`).
 *
 * `apply()` is identity — composition reads each source's trajectory directly.
 * The modifier still exists in the pipeline so it participates in array order,
 * `enabled` toggling, and the source list the composition step walks.
 *
 * Concrete implementations: {@link FileDataSource} (parsed/streamed file),
 * {@link MemoryDataSource} (in-memory single frame as a length-1 trajectory).
 */
export abstract class DataSourceModifier extends BaseModifier {
  /** Acquisition discriminator. See {@link DataSourceKind}. */
  abstract readonly kind: DataSourceKind;

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

  protected constructor(id: string, name: string) {
    super(id, name, new Set([ModifierCapability.TransformsData]));
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

  /** Free WASM resources. Called when the source is removed from the pipeline. */
  abstract dispose(): void;

  /**
   * Identity at apply time. Block composition happens in the composition step at
   * the head of `ModifierPipeline.compute`, not here.
   */
  apply(input: Frame, _ctx: PipelineContext): Frame {
    return input;
  }
}

/** Optional fields shared by the concrete data sources. */
export interface DataSourceOptions {
  filename?: string;
  sourceType?: DataSourceModifier["sourceType"];
  contributedBlocks?: ReadonlyArray<string>;
}

function applyOptions(
  ds: DataSourceModifier,
  options: DataSourceOptions,
): void {
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
export class FileDataSource extends DataSourceModifier {
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
    return this._cached ?? undefined;
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
export class MemoryDataSource extends DataSourceModifier {
  readonly kind = "memory" as const;

  private readonly _frame: Frame;
  private readonly _trajectory: Trajectory;

  constructor(frame: Frame, options: DataSourceOptions = {}) {
    super("memory-data-source", "Memory Source");
    this._frame = frame;
    this._trajectory = frameToTrajectory(frame);
    applyOptions(this, options);
  }

  get trajectory(): Trajectory {
    return this._trajectory;
  }

  /**
   * The wrapped single frame. Mutating it (Edit mode add/delete atoms)
   * propagates immediately since it is the same instance the length-1
   * trajectory holds.
   */
  get frame(): Frame {
    return this._frame;
  }

  get frameCount(): number {
    return 1;
  }

  getFrame(_index: number): Frame {
    // Index ignored: a memory source broadcasts its single frame.
    return this._frame;
  }

  async preload(_index: number): Promise<void> {
    // No-op — the frame is already in memory.
  }

  get cachedFrame(): Frame {
    return this._frame;
  }

  get peekFrame(): Frame {
    return this._frame;
  }

  dispose(): void {
    this._trajectory.dispose();
  }
}
