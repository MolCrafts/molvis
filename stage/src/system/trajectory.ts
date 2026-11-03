import { type Box, Frame } from "@molcrafts/molvis-core/molrs";
import { logger } from "../utils/logger";

/**
 * Per-section update ids of one frame: block name → the store update index
 * that frame resolves to (molrec `blockUpdateAt`). Two frames mapping a block
 * to the same id carry identical rows for it, so a consumer can skip
 * comparing that block's values. A block absent at the frame is not a key.
 */
export type SectionUpdates = ReadonlyMap<string, number>;

/**
 * Interface for lazy frame providers that load frames on demand.
 */
export interface FrameProvider {
  readonly length: number;
  get(index: number): Frame;
  /**
   * Optional index seam: the {@link SectionUpdates} of frame `index`, when
   * the backing store keeps one (mrec). Providers without a store index leave
   * this out and consumers fall back to value comparison.
   */
  sectionUpdates?(index: number): SectionUpdates | undefined;
}

/**
 * Async variant of {@link FrameProvider} used by the streaming worker
 * runtime. The provider is consulted by `Trajectory.frame(i)` and the
 * result is cached LRU-style by the trajectory.
 */
export interface AsyncFrameProvider {
  /**
   * Known complete length. Omit (or leave undefined) for a file scan
   * that is still discovering frames — {@link Trajectory.length} is
   * then `null` until {@link Trajectory.markIndexComplete}.
   */
  readonly length?: number;
  get(index: number): Promise<Frame>;
  /**
   * Optional index seam, same contract as {@link FrameProvider.sectionUpdates}.
   * Answers synchronously for frames the provider has already resolved
   * (the worker ships a frame's ids with the frame); `undefined` otherwise.
   */
  sectionUpdates?(index: number): SectionUpdates | undefined;
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
  /** Playable window — frames that have a FramePos / eager slot. */
  private _indexedLength: number;
  /** Known final N, or null while a file scan has not finished. */
  private _knownLength: number | null;
  private _indexComplete: boolean;
  private _providerOverrides = new Map<number, Frame>();

  constructor(frames: Frame[] = [], boxes: (Box | undefined)[] = []) {
    // Copy, never alias: `dropOldestFrame` and `addFrame` mutate these arrays,
    // and callers hand us arrays they still own (`renderer.ts` takes a user's
    // `Frame[]`, `state_sync.ts` passes a live state object's arrays). The
    // Frames themselves are still shared — only the containers are ours.
    this._frames = [...frames];
    this._boxes = [...boxes];
    this._indexedLength = frames.length;
    this._knownLength = frames.length;
    this._indexComplete = true;
    // Ensure boxes array matches frames length if not provided
    if (this._boxes.length < this._frames.length) {
      // Fill with undefined
      const missing = this._frames.length - this._boxes.length;
      for (let i = 0; i < missing; i++) this._boxes.push(undefined);
    }

    this._currentIndex = 0;
    if (this._indexedLength > 0) {
      logger.debug(`[Trajectory] built with ${this._indexedLength} frame(s)`);
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
    traj._indexedLength = provider.length;
    traj._knownLength = provider.length;
    traj._indexComplete = true;
    // Ensure boxes array matches provider length
    if (traj._boxes.length < traj._indexedLength) {
      const missing = traj._indexedLength - traj._boxes.length;
      for (let i = 0; i < missing; i++) traj._boxes.push(undefined);
    }
    if (traj._indexedLength > 0) {
      logger.debug(
        `[Trajectory] lazy provider with ${traj._indexedLength} frame(s)`,
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
   * frame has neither a replacement nor an entry in the LRU cache.
   * Callers should drive the trajectory
   * via the async {@link Trajectory.frame} accessor (used by
   * `System.seekFrame`).
   */
  static fromAsyncProvider(
    provider: AsyncFrameProvider,
    boxes: (Box | undefined)[] = [],
  ): Trajectory {
    const traj = new Trajectory([], boxes);
    traj._asyncProvider = provider;
    if (provider.length === undefined) {
      traj._indexedLength = 0;
      traj._knownLength = null;
      traj._indexComplete = false;
    } else {
      traj._indexedLength = provider.length;
      traj._knownLength = provider.length;
      traj._indexComplete = true;
    }
    if (traj._boxes.length < traj._indexedLength) {
      const missing = traj._indexedLength - traj._boxes.length;
      for (let i = 0; i < missing; i++) traj._boxes.push(undefined);
    }
    if (traj._indexedLength > 0) {
      logger.debug(
        `[Trajectory] async provider with ${traj._indexedLength} frame(s)`,
      );
    }
    return traj;
  }

  /**
   * Resolve the Frame at `index`. Replacements take priority over the LRU
   * cache and provider, including replacements made while a read is pending.
   * Otherwise cache the provider result and evict the oldest entry when full.
   *
   * For sync providers and eager arrays, returns `Promise.resolve(frame)`
   * so all callers can write `await trajectory.frame(i)` regardless of
   * the underlying provider shape.
   */
  async frame(index: number): Promise<Frame> {
    if (index < 0 || index >= this._indexedLength) {
      throw new Error(
        `Frame index ${index} out of range [0, ${this._indexedLength})`,
      );
    }

    const override = this._providerOverrides.get(index);
    if (override) return override;

    if (this._asyncProvider) {
      const provider = this._asyncProvider;
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

      let frame: Frame;
      try {
        frame = await provider.get(index);
      } catch (error) {
        const replacement = this._providerOverrides.get(index);
        if (replacement) return replacement;
        throw error;
      }
      if (this._asyncProvider !== provider) {
        throw new Error("Trajectory disposed during frame load");
      }
      const replacement = this._providerOverrides.get(index);
      if (replacement) return replacement;
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

  /**
   * Store-index seam: the {@link SectionUpdates} of frame `index`, or
   * `undefined` when the backing provider keeps no index, `index` is out of
   * range, or the frame at `index` was replaced in place
   * ({@link replaceFrame}) and no longer is the store's row set.
   */
  sectionUpdates(index: number): SectionUpdates | undefined {
    if (index < 0 || index >= this._indexedLength) return undefined;
    if (this._providerOverrides.has(index)) return undefined;
    const provider = this._asyncProvider ?? this._provider;
    return provider?.sectionUpdates?.(index);
  }

  /**
   * Whether index has a replacement, an async LRU entry, or a sync frame
   * available. Used by prefetch to skip redundant work.
   */
  hasCachedFrame(index: number): boolean {
    if (index < 0 || index >= this._indexedLength) return false;
    if (this._providerOverrides.has(index)) return true;
    if (this._asyncProvider) return this._asyncCache.has(index);
    // Sync / lazy-sync paths resolve without a network hop; treat as warm.
    return true;
  }

  /**
   * Fire-and-forget warm of neighbor frames into the async LRU.
   * Never mutates {@link currentIndex}. Out-of-range indices are skipped.
   * Provider rejections (cancelled latest-wins loads) are swallowed.
   */
  prefetch(indices: readonly number[]): void {
    if (!this._asyncProvider || this._indexedLength === 0) return;
    for (const index of indices) {
      if (index < 0 || index >= this._indexedLength) continue;
      if (this.hasCachedFrame(index)) continue;
      void this.frame(index).catch(() => {
        // Prefetch is best-effort; supersede/cancel is normal.
      });
    }
  }

  private _getFrame(index: number): Frame {
    const override = this._providerOverrides.get(index);
    if (override) return override;

    if (this._asyncProvider) {
      const cached = this._asyncCache.get(index);
      if (cached) return cached;
      throw new Error(
        `Frame index ${index} is not cached; await trajectory.frame(${index}) first`,
      );
    }

    if (this._provider) {
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
    if (this._indexedLength === 0) {
      return new Frame();
    }
    return this._getFrame(this._currentIndex);
  }

  /**
   * Get the current Box (if any).
   */
  get currentBox(): Box | undefined {
    if (this._indexedLength === 0) {
      return undefined;
    }
    return (
      this._boxes[this._currentIndex] ?? this._getFrame(this._currentIndex)?.box
    );
  }

  /**
   * Get the current frame index.
   */
  get currentIndex(): number {
    return this._currentIndex;
  }

  /**
   * Known final frame count, or `null` while a file index is still
   * being discovered. Never increments as frames are scanned — use
   * {@link indexedLength} for the playable window.
   */
  get length(): number | null {
    return this._knownLength;
  }

  /** Frames that already have a slot / FramePos and may be seeked. */
  get indexedLength(): number {
    return this._indexedLength;
  }

  /** True after {@link markIndexComplete} (eager trajectories start true). */
  get indexComplete(): boolean {
    return this._indexComplete;
  }

  /**
   * Advance the discovered-frame window. Does not change {@link length}
   * unless `knownLength` is passed (header / complete sidecar).
   */
  recordIndexedLength(
    indexedLength: number,
    knownLength?: number | null,
  ): void {
    if (indexedLength < this._indexedLength) {
      throw new Error(
        `Trajectory.recordIndexedLength: cannot shrink ${this._indexedLength} → ${indexedLength}`,
      );
    }
    this._indexedLength = indexedLength;
    if (knownLength !== undefined) this._knownLength = knownLength;
  }

  /**
   * Mark the file index finished. Sets `length` to `indexedLength` when
   * it was still unknown. Throws if a previously advertised N disagrees.
   */
  markIndexComplete(): void {
    if (
      this._knownLength !== null &&
      this._knownLength !== this._indexedLength
    ) {
      throw new Error(
        `Trajectory.markIndexComplete: known length ${this._knownLength} !== indexed ${this._indexedLength}`,
      );
    }
    this._indexComplete = true;
    this._knownLength = this._indexedLength;
  }

  /**
   * Final N for whole-trajectory consumers. Throws until the index is
   * complete and `length` is known.
   */
  requireCompleteLength(purpose: string): number {
    if (!this._indexComplete || this._knownLength === null) {
      throw new Error(
        `Trajectory length is not complete (${purpose}); indexed ${this._indexedLength}`,
      );
    }
    return this._knownLength;
  }

  /**
   * True when frames are loaded on demand via a {@link FrameProvider}
   * or {@link AsyncFrameProvider}.
   */
  get isLazy(): boolean {
    return this._provider !== undefined || this._asyncProvider !== undefined;
  }

  /**
   * Return the frame at `index`, or `undefined` if out of range.
   * For async providers, throws if the frame has not been loaded or replaced.
   * Consumers that need per-frame metadata walk the trajectory via
   * this accessor — there is no separate aggregation layer.
   */
  get(index: number): Frame | undefined {
    if (index < 0 || index >= this._indexedLength) return undefined;
    return this._getFrame(index);
  }

  /**
   * Add a frame to the trajectory.
   */
  addFrame(frame: Frame, box?: Box): void {
    this._frames.push(frame);
    this._boxes.push(box);
    this._indexedLength = this._provider
      ? this._indexedLength + 1
      : this._frames.length;
    if (this._indexComplete) this._knownLength = this._indexedLength;
  }

  /**
   * Drop the oldest frame, releasing our reference to it.
   *
   * The counterpart to {@link addFrame} for a trajectory that is bounded at
   * the head — a live stream under a retention cap. Every remaining index
   * shifts down by one, so callers that hold an index must treat it as a
   * position in the retained window rather than a step number.
   *
   * Deliberately does **not** call `frame.free()`, for the same reason the
   * async LRU eviction path above does not: the canvas consumers
   * (`AtomSource`, `SceneIndex`, `Artist`) can still be bound to the evicted
   * frame — a user paused on the retained head while the producer keeps
   * appending is the ordinary case, not a corner one. Freeing here hands
   * them a dangling pointer ("null pointer passed to rust"). Dropping the
   * reference lets the wasm-bindgen `FinalizationRegistry` reclaim the WASM
   * memory once nothing holds the wrapper. Explicit frees belong in
   * {@link dispose}, which runs when nothing can still be looking.
   *
   * Returns `false` when there is nothing to drop, or when the trajectory is
   * provider-backed (a lazily-read file has no head to evict).
   */
  dropOldestFrame(): boolean {
    if (this._provider || this._frames.length === 0) return false;
    this._frames.splice(0, 1);
    this._boxes.splice(0, 1);
    this._indexedLength = this._frames.length;
    if (this._indexComplete) this._knownLength = this._indexedLength;
    if (this._currentIndex > 0) this._currentIndex--;
    return true;
  }

  /**
   * Move to the next frame.
   * Clamps to the last frame.
   * Returns true if the index changed.
   */
  next(): boolean {
    if (
      this._indexedLength === 0 ||
      this._currentIndex >= this._indexedLength - 1
    ) {
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
    if (this._indexedLength === 0 || this._currentIndex <= 0) {
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
    if (this._indexedLength === 0) return false;

    const newIndex = Math.max(0, Math.min(index, this._indexedLength - 1));
    if (newIndex !== this._currentIndex) {
      this._currentIndex = newIndex;
      return true;
    }
    return false;
  }
  /**
   * Free the WASM {@link Frame} objects this trajectory owns.
   *
   * Eager trajectories own their frames' WASM linear-memory backing; dropping
   * the trajectory (e.g. on reload via `setTrajectory`) without freeing leaks
   * that memory. Call this on the *outgoing* trajectory once it is no longer
   * the active one.
   *
   * - **Lazy/provider-backed** trajectories are skipped — the provider owns
   *   frame lifetime (and reuses/evicts via its own LRU).
   * - Frames in `exclude` are still referenced elsewhere (e.g. the app's
   *   source / last-rendered frame) and are left untouched to avoid a
   *   use-after-free / double-free.
   * - Boxes are intentionally not freed here: their ownership flows into draw
   *   commands and `currentBox` falls back to `frame.box`, so freeing them
   *   risks a double-free. They are released with their frame.
   *
   * Async (streaming) trajectories release their provider and the LRU cache
   * of materialized Frames instead of an eager `_frames` array; sync
   * provider-backed trajectories own nothing here (the provider manages frame
   * lifetime). Frames in `exclude` are left untouched in every mode.
   *
   * After `dispose()` the trajectory holds no frames and must not be reused.
   */
  dispose(exclude?: ReadonlySet<Frame>): void {
    // Async provider-backed (streaming worker): release the provider and the
    // LRU of materialized Frames. Disposal is the one place we DO call
    // `frame.free()` explicitly — by teardown no consumer is navigating the
    // trajectory, so racing with active references is not a concern.
    if (this._asyncProvider) {
      this._asyncProvider.dispose?.();
      this._asyncProvider = undefined;
      for (const frame of this._asyncCache.values()) {
        if (exclude?.has(frame)) continue;
        try {
          frame.free();
        } catch {
          // Already freed by GC — ignore.
        }
      }
      this._asyncCache.clear();
      // Replacements are also held by edit/scene owners; drop our handles.
      this._providerOverrides.clear();
      this._frames = [];
      this._boxes = [];
      this._indexedLength = 0;
      this._knownLength = 0;
      this._indexComplete = true;
      return;
    }
    // Sync provider-backed: the provider owns frame lifetime, nothing to free.
    if (this._provider) return;
    // Eager: free owned frames except those still referenced elsewhere.
    for (const frame of this._frames) {
      if (!frame || exclude?.has(frame)) continue;
      frame.free();
    }
    this._frames = [];
    this._boxes = [];
    this._indexedLength = 0;
    this._knownLength = 0;
    this._indexComplete = true;
  }

  /**
   * Replace a frame at the specified index.
   * NOTE: This mutates the trajectory in place for performance — it is called
   * on every pipeline-driven visual update. The caller (System.updateCurrentFrame)
   * relies on in-place mutation to avoid reconstructing the entire Trajectory.
   */
  replaceFrame(index: number, frame: Frame, box?: Box): boolean {
    if (index < 0 || index >= this._indexedLength) {
      return false;
    }

    if (this._asyncProvider) {
      // Edits survive LRU eviction and invalidate the provider's section ids.
      this._providerOverrides.set(index, frame);
      this._asyncCache.delete(index);
      this._boxes[index] = box;
      return true;
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

/**
 * Wrap a single {@link Frame} as a length-1 {@link Trajectory}, the canonical
 * "Frame = length-1 Trajectory" form source composition relies on.
 *
 * The result is eager (`isLazy === false`) and holds the frame by reference —
 * this helper does NOT clone or free `frame`. The returned Trajectory owns the
 * frame's WASM lifetime via `dispose()` like any eager trajectory; the caller
 * decides when to dispose.
 *
 * @param frame the frame to wrap.
 * @returns a Trajectory of length 1 whose `get(0)` / `frame(0)` is `frame`.
 */
export function frameToTrajectory(frame: Frame): Trajectory {
  return new Trajectory([frame]);
}
