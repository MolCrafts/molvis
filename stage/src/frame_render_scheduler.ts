/**
 * Coalescing scheduler for trajectory-frame renders ("latest-wins").
 *
 * Rapid requests (e.g. timeline scrubbing) collapse: while a render is in
 * flight, at most one follow-up is kept, and intermediate requests are
 * dropped — only the most recent runs once the current render settles. A
 * `forceFull` request upgrades a pending one so a needed full rebuild is never
 * downgraded to a fast update.
 *
 * Extracted from MolvisApp so the queue logic is unit-testable without a scene
 * or WASM: it depends only on the injected `render` callback.
 */
export class FrameRenderScheduler {
  private queue: Promise<void> = Promise.resolve();
  private pending: { forceFull: boolean } | null = null;

  constructor(
    private readonly render: (forceFull: boolean) => Promise<void>,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  /**
   * Request a render. If one is already queued, coalesce into it (upgrading to
   * forceFull when asked) instead of enqueuing another.
   */
  request(forceFull = false): void {
    if (this.pending) {
      if (forceFull) this.pending.forceFull = true;
      return;
    }

    this.pending = { forceFull };
    this.queue = this.queue
      .catch(() => {
        // Previous render's failure was already routed to onError; keep the
        // chain alive so future requests still run.
      })
      .then(async () => {
        const pending = this.pending;
        this.pending = null;
        if (pending) await this.render(pending.forceFull);
      })
      .catch((error) => this.onError(error));
  }

  /** Resolves once the currently queued render settles. Primarily a test aid. */
  idle(): Promise<void> {
    return this.queue;
  }
}
