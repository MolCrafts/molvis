import type { Frame } from "@molcrafts/molrs";
import type { Trajectory } from "../system/trajectory";
import { BaseModifier, ModifierCapability } from "./modifier";
import type { PipelineContext } from "./types";

/**
 * Discriminator for a {@link DataSourceModifier}'s temporal nature.
 *
 * - `trajectory` — backed by a multi-frame {@link Trajectory}.
 *   `frameCount` reflects trajectory length; `getFrame(i)` returns the
 *   i-th frame.
 * - `frame` — backed by a single {@link Frame}. `frameCount` is always
 *   `1`; `getFrame(_)` returns the same frame regardless of index. This
 *   is the broadcast mechanism that lets a static topology file
 *   contribute to every step of an N-frame trajectory.
 */
export type DataSourceKind = "trajectory" | "frame";

/**
 * A data source attached to the pipeline. Each DataSourceModifier owns
 * the data it contributes to the merged frame produced by
 * `ModifierPipeline.compute`. Multiple DSs in the same pipeline stack
 * their blocks onto a working frame in pipeline-array order; later DSs
 * overwrite earlier ones (last-wins) on block-name conflict.
 *
 * `apply()` is identity — block injection lives in pipeline phase A,
 * not here. The modifier still exists in the pipeline so it can
 * participate in array order, parent/child grouping, and `enabled`
 * toggling.
 *
 * Concrete implementations: {@link TrajectoryDataSource} (N frames),
 * {@link FrameDataSource} (1 frame, broadcast across the system).
 */
export abstract class DataSourceModifier extends BaseModifier {
  /** Discriminator. See {@link DataSourceKind}. */
  abstract readonly kind: DataSourceKind;

  /** Provenance: where the data came from. */
  public sourceType: "file" | "empty" | "backend" = "empty";

  /** Display label (file name / "backend session" / etc.). */
  public filename = "";

  /**
   * Optional narrowing filter for phase A. Empty (the default) means
   * "every block present on the source frame is contributed" — the
   * merge consults `frame.blockNames()` at compute time, so new block
   * kinds flow through automatically without registry edits. Populate
   * to restrict to a subset, e.g. `["bonds"]` for a topology-only file
   * that should NOT shadow another DS's atoms.
   */
  public contributedBlocks: ReadonlyArray<string> = [];

  /**
   * @deprecated UI-only visibility flags. Will be replaced by per-DS
   * Draw modifier `enabled` toggles in phase 3 of the multi-DS spec
   * (`docs/specs/multi-data-source-pipeline.md`).
   */
  public showAtoms = true;
  /** @deprecated See {@link DataSourceModifier.showAtoms}. */
  public showBonds = true;
  /** @deprecated See {@link DataSourceModifier.showAtoms}. */
  public showBox = true;

  protected constructor(id: string, name: string) {
    super(id, name, new Set([ModifierCapability.TransformsData]));
  }

  /** Number of frames this DS provides. Trajectory = N, Frame = 1. */
  abstract get frameCount(): number;

  /**
   * Resolve the contributing frame for the given pipeline index.
   *
   * - {@link TrajectoryDataSource} returns `trajectory.frame(index)`.
   * - {@link FrameDataSource} returns its single frame regardless of
   *   `index` (static-topology broadcast).
   *
   * May be async when the underlying source is streamed
   * (worker-backed). Callers MUST await before reading blocks.
   */
  abstract getFrame(index: number): Promise<Frame> | Frame;

  /**
   * Pre-load the frame at `index` into a synchronous cache. Called by
   * the pipeline before phase A so the merge step can read
   * synchronously. Throws if `index` is out of range.
   */
  abstract preload(index: number): Promise<void>;

  /**
   * Sync access to the most recently preloaded frame. Throws if
   * `preload()` has not been called.
   */
  abstract get cachedFrame(): Frame;

  /**
   * Best-effort sync access to the cached frame. Returns `undefined`
   * before the first `preload()` rather than throwing — suitable for
   * UI panels that render before the pipeline has had a chance to
   * preload (and re-render after `frame-change` fires).
   */
  abstract get peekFrame(): Frame | undefined;

  /** Free WASM resources. Called when the DS is removed from the pipeline. */
  abstract dispose(): void;

  /**
   * Identity at apply time. Actual block injection happens during
   * pipeline phase A inside `ModifierPipeline.compute`.
   */
  apply(input: Frame, _ctx: PipelineContext): Frame {
    return input;
  }
}

/** Optional fields shared by both concrete data sources. */
export interface DataSourceOptions {
  filename?: string;
  sourceType?: DataSourceModifier["sourceType"];
  contributedBlocks?: ReadonlyArray<string>;
}

/**
 * A data source backed by a multi-frame {@link Trajectory}. `getFrame(i)`
 * returns the i-th frame; `frameCount` reflects trajectory length.
 * Eager and async-streaming trajectories are both supported through
 * `Trajectory.frame(i)`'s unified async accessor.
 */
export class TrajectoryDataSource extends DataSourceModifier {
  readonly kind = "trajectory" as const;

  private readonly _trajectory: Trajectory;
  private _cached: Frame | null = null;

  constructor(trajectory: Trajectory, options: DataSourceOptions = {}) {
    super("trajectory-data-source", "Data Source");
    this._trajectory = trajectory;
    if (options.filename !== undefined) this.filename = options.filename;
    if (options.sourceType !== undefined) this.sourceType = options.sourceType;
    if (options.contributedBlocks !== undefined) {
      this.contributedBlocks = options.contributedBlocks;
    }
  }

  /** The wrapped trajectory. Replace by removing + re-adding the DS. */
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
        `TrajectoryDataSource ${this.id}: frame index ${index} out of range [0, ${this._trajectory.length})`,
      );
    }
    this._cached = await this._trajectory.frame(index);
  }

  get cachedFrame(): Frame {
    if (this._cached === null) {
      throw new Error(
        `TrajectoryDataSource ${this.id}: cachedFrame accessed before preload()`,
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
 * A data source carrying a single static {@link Frame}. `getFrame(_)`
 * returns the same frame regardless of index — this is the broadcast
 * mechanism that lets a 1-frame topology file contribute to every step
 * of an N-frame trajectory.
 */
export class FrameDataSource extends DataSourceModifier {
  readonly kind = "frame" as const;

  private readonly _frame: Frame;

  constructor(frame: Frame, options: DataSourceOptions = {}) {
    super("frame-data-source", "Data Source");
    this._frame = frame;
    if (options.filename !== undefined) this.filename = options.filename;
    if (options.sourceType !== undefined) this.sourceType = options.sourceType;
    if (options.contributedBlocks !== undefined) {
      this.contributedBlocks = options.contributedBlocks;
    }
  }

  /**
   * The wrapped single frame. Mutating it (Edit mode add/delete atoms)
   * is allowed and propagates immediately to every pipeline frame
   * since `getFrame(_)` returns this same instance.
   */
  get frame(): Frame {
    return this._frame;
  }

  get frameCount(): number {
    return 1;
  }

  getFrame(_index: number): Frame {
    // Index is intentionally ignored: a FrameDataSource broadcasts its
    // single frame across the whole pipeline timeline.
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
    try {
      this._frame.free();
    } catch {
      // Already freed by molrs's FinalizationRegistry — safe to ignore.
    }
  }
}
