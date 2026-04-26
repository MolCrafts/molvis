import { type Box, Frame } from "@molcrafts/molrs";
import { logger } from "../utils/logger";

/**
 * Interface for lazy frame providers that load frames on demand.
 */
export interface FrameProvider {
  readonly length: number;
  get(index: number): Frame;
}

/**
 * Async variant of {@link FrameProvider} used by the streaming worker
 * runtime. The provider is consulted by `Trajectory.frame(i)` and the
 * result is cached LRU-style by the trajectory.
 */
export interface AsyncFrameProvider {
  readonly length: number;
  get(index: number): Promise<Frame>;
  /** Optional cleanup hook — called from `Trajectory.dispose()`. */
  dispose?(): void;
}

/**
 * Trajectory class manages a sequence of Frames.
 * It provides navigation methods to switch between frames.
 * Supports both eager (Frame[]) and lazy (FrameProvider) modes.
 */
export class Trajectory {
  private _frames: Frame[];
  private _boxes: (Box | undefined)[];
  private _currentIndex: number;
  private _provider?: FrameProvider;
  private _asyncProvider?: AsyncFrameProvider;
  private _asyncCache = new Map<number, Frame>();
  private _asyncCacheLimit = 16;
  private _length: number;
  private _providerOverrides = new Map<number, Frame>();

  constructor(frames: Frame[] = [], boxes: (Box | undefined)[] = []) {
    this._frames = frames;
    this._boxes = boxes;
    this._length = frames.length;
    // Ensure boxes array matches frames length if not provided
    if (this._boxes.length < this._frames.length) {
      // Fill with undefined
      const missing = this._frames.length - this._boxes.length;
      for (let i = 0; i < missing; i++) this._boxes.push(undefined);
    }

    this._currentIndex = 0;
    if (this._length > 0) {
      logger.info(`[Trajectory] Initialized with ${this._length} frames`);
    }
  }

  /**
   * Create a Trajectory backed by a lazy FrameProvider.
   * Frames are loaded on demand instead of all at once.
   */
  static fromProvider(
    provider: FrameProvider,
    boxes: (Box | undefined)[] = [],
  ): Trajectory {
    const traj = new Trajectory([], boxes);
    traj._provider = provider;
    traj._length = provider.length;
    // Ensure boxes array matches provider length
    if (traj._boxes.length < traj._length) {
      const missing = traj._length - traj._boxes.length;
      for (let i = 0; i < missing; i++) traj._boxes.push(undefined);
    }
    if (traj._length > 0) {
      logger.info(
        `[Trajectory] Initialized lazy provider with ${traj._length} frames`,
      );
    }
    return traj;
  }

  /**
   * Build a Trajectory backed by an async provider. Used by the
   * streaming worker runtime: the worker resolves frames on demand
   * and the trajectory keeps a small LRU of materialized molrs Frames
   * around the playhead.
   *
   * Sync accessors (`currentFrame`, `get(i)`) throw if the requested
   * frame is not in the LRU cache. Callers should drive the trajectory
   * via the async {@link Trajectory.frame} accessor (used by
   * `System.seekFrame`).
   */
  static fromAsyncProvider(
    provider: AsyncFrameProvider,
    boxes: (Box | undefined)[] = [],
  ): Trajectory {
    const traj = new Trajectory([], boxes);
    traj._asyncProvider = provider;
    traj._length = provider.length;
    if (traj._boxes.length < traj._length) {
      const missing = traj._length - traj._boxes.length;
      for (let i = 0; i < missing; i++) traj._boxes.push(undefined);
    }
    if (traj._length > 0) {
      logger.info(
        `[Trajectory] Initialized async provider with ${traj._length} frame(s)`,
      );
    }
    return traj;
  }

  /**
   * Resolve the Frame at `index`. Hits the LRU cache first; otherwise
   * delegates to the async provider, caches the result, and evicts
   * the oldest entry when the cache is full.
   *
   * For sync providers and eager arrays, returns `Promise.resolve(frame)`
   * so all callers can write `await trajectory.frame(i)` regardless of
   * the underlying provider shape.
   */
  async frame(index: number): Promise<Frame> {
    if (index < 0 || index >= this._length) {
      throw new Error(`Frame index ${index} out of range [0, ${this._length})`);
    }

    if (this._asyncProvider) {
      const cached = this._asyncCache.get(index);
      if (cached) {
        // Promote on hit: Map insertion order is the LRU we evict
        // against, so re-insert to mark this entry as most-recent.
        // Without this, the cache degenerates to FIFO and back-and-
        // forth scrubbing repeatedly evicts the recently-used frame.
        this._asyncCache.delete(index);
        this._asyncCache.set(index, cached);
        return cached;
      }

      const frame = await this._asyncProvider.get(index);
      this._asyncCache.set(index, frame);
      if (this._asyncCache.size > this._asyncCacheLimit) {
        const oldest = this._asyncCache.keys().next().value as
          | number
          | undefined;
        if (oldest !== undefined) {
          // Evict the oldest entry from the LRU but do NOT call
          // `frame.free()`. The wasm-bindgen `FinalizationRegistry`
          // installed by molrs will release WASM memory when JS GC
          // collects the Frame wrapper. Explicit free here invariably
          // races with consumers (AtomSource, SceneIndex, Artist) that
          // still hold a reference between `frame-change` and the
          // matching `setFrame(newFrame)` call — even an
          // animation-frame defer wasn't enough during fast scrubbing.
          this._asyncCache.delete(oldest);
        }
      }
      return frame;
    }

    return this._getFrame(index);
  }

  /** Free the async provider and drop all cached Frames. Idempotent.
   *  Disposal is the one place we DO call `frame.free()` explicitly —
   *  by the time the trajectory is being torn down, no consumer is
   *  navigating into it anymore, so racing with active references is
   *  not a concern. */
  dispose(): void {
    if (this._asyncProvider) {
      this._asyncProvider.dispose?.();
      this._asyncProvider = undefined;
    }
    for (const frame of this._asyncCache.values()) {
      try {
        frame.free();
      } catch {
        // Already freed by GC — ignore.
      }
    }
    this._asyncCache.clear();
  }

  private _getFrame(index: number): Frame {
    if (this._provider) {
      const override = this._providerOverrides.get(index);
      if (override) return override;

      const providerLength = this._provider.length;
      if (index < providerLength) {
        return this._provider.get(index);
      }

      return this._frames[index - providerLength];
    }
    return this._frames[index];
  }

  /**
   * Get the current Frame.
   * Returns a new empty Frame if the trajectory is empty.
   */
  get currentFrame(): Frame {
    if (this._length === 0) {
      return new Frame();
    }
    return this._getFrame(this._currentIndex);
  }

  /**
   * Get the current Box (if any).
   */
  get currentBox(): Box | undefined {
    if (this._length === 0) {
      return undefined;
    }
    return (
      this._boxes[this._currentIndex] ??
      this._getFrame(this._currentIndex)?.simbox
    );
  }

  /**
   * Get the current frame index.
   */
  get currentIndex(): number {
    return this._currentIndex;
  }

  /**
   * Get the total number of frames.
   */
  get length(): number {
    return this._length;
  }

  /**
   * Return the frame at `index`, or `undefined` if out of range.
   * Consumers that need per-frame metadata walk the trajectory via
   * this accessor — there is no separate aggregation layer.
   */
  get(index: number): Frame | undefined {
    if (index < 0 || index >= this._length) return undefined;
    return this._getFrame(index);
  }

  /**
   * Add a frame to the trajectory.
   */
  addFrame(frame: Frame, box?: Box): void {
    this._frames.push(frame);
    this._boxes.push(box);
    this._length = this._provider ? this._length + 1 : this._frames.length;
  }

  /**
   * Move to the next frame.
   * Clamps to the last frame.
   * Returns true if the index changed.
   */
  next(): boolean {
    if (this._length === 0 || this._currentIndex >= this._length - 1) {
      return false;
    }
    this._currentIndex++;
    return true;
  }

  /**
   * Move to the previous frame.
   * Clamps to the first frame.
   * Returns true if the index changed.
   */
  prev(): boolean {
    if (this._length === 0 || this._currentIndex <= 0) {
      return false;
    }
    this._currentIndex--;
    return true;
  }

  /**
   * Seek to a specific frame index.
   * Clamps to the valid range [0, length - 1].
   * Returns true if the index changed.
   */
  seek(index: number): boolean {
    if (this._length === 0) return false;

    const newIndex = Math.max(0, Math.min(index, this._length - 1));
    if (newIndex !== this._currentIndex) {
      this._currentIndex = newIndex;
      return true;
    }
    return false;
  }
  /**
   * Replace a frame at the specified index.
   * NOTE: This mutates the trajectory in place for performance — it is called
   * on every pipeline-driven visual update. The caller (System.updateCurrentFrame)
   * relies on in-place mutation to avoid reconstructing the entire Trajectory.
   */
  replaceFrame(index: number, frame: Frame, box?: Box): boolean {
    if (index < 0 || index >= this._length) {
      return false;
    }

    if (this._provider) {
      const providerLength = this._provider.length;
      if (index < providerLength) {
        this._providerOverrides.set(index, frame);
      } else {
        this._frames[index - providerLength] = frame;
      }
      this._boxes[index] = box;
      return true;
    }

    this._frames[index] = frame;
    this._boxes[index] = box;
    return true;
  }
}
