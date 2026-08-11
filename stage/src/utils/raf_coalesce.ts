/**
 * Coalesce repeated work onto the next animation frame.
 *
 * Used by {@link MolvisApp} ResizeObserver so splitter drag does not call
 * `engine.resize()` once per pointermove.
 */
export interface RafCoalesce {
  /** Schedule `fn` for the next frame (no-op if already scheduled). */
  schedule(): void;
  /** Cancel pending frame and run `fn` immediately. */
  flush(): void;
  /** Drop a pending frame without running. */
  cancel(): void;
  /** True when a frame is pending. */
  readonly pending: boolean;
}

export type RafSchedule = (cb: FrameRequestCallback) => number;
export type RafCancel = (id: number) => void;

/**
 * @param fn - Work to run (once per coalesced batch).
 * @param schedule - Inject `requestAnimationFrame` (tests).
 * @param cancel - Inject `cancelAnimationFrame` (tests).
 */
export function createRafCoalesce(
  fn: () => void,
  schedule: RafSchedule = (
    globalThis as { requestAnimationFrame?: RafSchedule }
  ).requestAnimationFrame?.bind(globalThis) ??
    ((cb) => setTimeout(() => cb(0), 0) as unknown as number),
  cancel: RafCancel = (
    globalThis as { cancelAnimationFrame?: RafCancel }
  ).cancelAnimationFrame?.bind(globalThis) ??
    ((id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>)),
): RafCoalesce {
  let id: number | null = null;
  return {
    get pending() {
      return id !== null;
    },
    schedule() {
      if (id !== null) return;
      id = schedule(() => {
        id = null;
        fn();
      });
    },
    flush() {
      if (id !== null) {
        cancel(id);
        id = null;
      }
      fn();
    },
    cancel() {
      if (id === null) return;
      cancel(id);
      id = null;
    },
  };
}
