import { type Box, Frame } from "@molcrafts/molrs";
import type { EventEmitter, MolvisEventMap } from "./events";
import { Trajectory } from "./system/trajectory";
import { logger } from "./utils/logger";

/**
 * System class manages all data and structure-related operations.
 * Parallel to World (which handles rendering), System handles data.
 *
 * A dataset is always a `Trajectory` — a single frame is just a
 * one-element trajectory. There is no separate "set single frame" entry
 * point; callers assign `system.trajectory = new Trajectory([frame], [box])`.
 *
 * Frames in async-backed trajectories (streaming worker) cannot be read
 * synchronously. To keep the read API stable for renderers and modifiers,
 * `System` keeps a `_currentFrame` cache that mirrors the trajectory's
 * current index. Navigation methods (`seekFrame` / `nextFrame` / `prevFrame`)
 * are `async` and resolve once the new frame has been written to the
 * cache; the sync `frame` getter always returns the cache.
 */
export class System {
  private _trajectory: Trajectory;
  private _currentFrame: Frame;
  private events?: EventEmitter<MolvisEventMap>;
  /** Monotonic id of the most-recently-issued seek; load callbacks
   *  compare against this to avoid clobbering the cache with a stale
   *  result when the user scrubs faster than the worker can parse. */
  private _loadCounter = 0;
  private _activeLoad: number | null = null;

  constructor(events?: EventEmitter<MolvisEventMap>) {
    this.events = events;
    this._trajectory = new Trajectory([new Frame()]);
    this._currentFrame = this._trajectory.currentFrame;
    logger.info("[System] Initialized with empty frame");
  }

  /**
   * Get the current Trajectory.
   */
  get trajectory(): Trajectory {
    return this._trajectory;
  }

  /**
   * Sync setter — only valid for trajectories whose frames can be
   * accessed synchronously (eager arrays, sync providers). Throws via
   * `Trajectory.currentFrame` if used with an async-only trajectory;
   * use `await system.setTrajectory(...)` instead.
   */
  set trajectory(value: Trajectory) {
    this._trajectory = value;
    this._activeLoad = null;
    this._currentFrame = value.length > 0 ? value.currentFrame : new Frame();
    logger.info(`[System] Trajectory set with ${value.length} frame(s)`);
    this.events?.emit("trajectory-change", value);
    this.events?.emit("frame-change", this._trajectory.currentIndex);
  }

  /**
   * Async setter — used by the streaming worker runtime. Awaits the
   * resolution of frame 0 (or the trajectory's current index) and
   * primes the `_currentFrame` cache before emitting events.
   */
  async setTrajectory(value: Trajectory): Promise<void> {
    this._trajectory = value;
    this._activeLoad = null;
    if (value.length > 0) {
      this._currentFrame = await value.frame(value.currentIndex);
    } else {
      this._currentFrame = new Frame();
    }
    logger.info(
      `[System] Trajectory set with ${value.length} frame(s) (async)`,
    );
    this.events?.emit("trajectory-change", value);
    this.events?.emit("frame-change", this._trajectory.currentIndex);
  }

  /**
   * Get the current Frame. Reads from the cache populated by the
   * trajectory setter / seek methods — sync for all consumers.
   */
  get frame(): Frame {
    return this._currentFrame;
  }

  /**
   * Get the current Box (from the active trajectory).
   */
  get box(): Box | undefined {
    return this._trajectory.currentBox;
  }

  /**
   * Update the currently active frame content in-place without
   * reconstructing the trajectory. Used by pipeline-driven visual updates
   * (modifiers) where topology stays fixed. Falls back to replacing the
   * trajectory when the index is out of range (empty trajectory).
   */
  public updateCurrentFrame(frame: Frame, box?: Box): void {
    const currentIndex = this._trajectory.currentIndex;
    if (this._trajectory.replaceFrame(currentIndex, frame, box)) {
      this._currentFrame = frame;
      this.events?.emit("frame-change", currentIndex);
    } else {
      this.trajectory = new Trajectory([frame], [box]);
    }
  }

  // -------------------------------------------------------------------------
  //  Navigation — all async to support streaming trajectories. Sync trajectories
  //  resolve immediately so cost is essentially zero.
  // -------------------------------------------------------------------------

  public async nextFrame(): Promise<boolean> {
    return this._navigateTo(this._trajectory.currentIndex + 1);
  }

  public async prevFrame(): Promise<boolean> {
    return this._navigateTo(this._trajectory.currentIndex - 1);
  }

  public async seekFrame(index: number): Promise<boolean> {
    return this._navigateTo(index);
  }

  private async _navigateTo(rawIndex: number): Promise<boolean> {
    const length = this._trajectory.length;
    if (length === 0) return false;
    const index = Math.max(0, Math.min(rawIndex, length - 1));
    if (index === this._trajectory.currentIndex && this._activeLoad === null) {
      return false;
    }

    const loadId = ++this._loadCounter;
    this._activeLoad = loadId;
    this.events?.emit("frame-load-start", {
      frameId: index,
      requestId: loadId,
    });

    let frame: Frame;
    try {
      frame = await this._trajectory.frame(index);
    } catch (err) {
      this.events?.emit("frame-load-end", {
        frameId: index,
        requestId: loadId,
        success: false,
      });
      throw err;
    }

    if (this._activeLoad !== loadId) {
      // Superseded by a newer seek — the trajectory's LRU still owns
      // this Frame; we just ignore it.
      this.events?.emit("frame-load-end", {
        frameId: index,
        requestId: loadId,
        success: false,
      });
      return false;
    }

    this._trajectory.seek(index);
    this._currentFrame = frame;
    this._activeLoad = null;
    this.events?.emit("frame-change", index);
    this.events?.emit("frame-load-end", {
      frameId: index,
      requestId: loadId,
      success: true,
    });
    return true;
  }
}
