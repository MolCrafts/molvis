/**
 * Worker-side helpers for the generic workload protocol whose main-thread
 * half is `WorkloadHost` (`./host.ts`).
 *
 * Call {@link installWorkloadHandler} once at the top of a dedicated
 * worker module. Domain code only implements `run`.
 */

/// <reference lib="webworker" />

import type { WorkloadRequest, WorkloadResponse } from "./protocol";

/** What a job implementation gets besides its payload. */
export interface WorkloadWorkerContext {
  /** Correlated job id from the host. */
  id: number;
  /**
   * True after the host sent `{ type: "cancel", id }` for this job. A flag to
   * poll, not a signal that interrupts — nothing stops until the job checks it.
   */
  isCancelled: () => boolean;
  /**
   * Stream progress (any domain shape) to the host as
   * `{ type: "progress", id, progress }`. Also arms the heartbeat: see
   * {@link WorkloadHandlerOptions.heartbeatMs}.
   */
  reportProgress: (progress: unknown) => void;
}

/** Domain hooks for {@link installWorkloadHandler}. */
export interface WorkloadHandlerOptions<TJob, TResult> {
  /**
   * Execute one job. May be async; cooperative cancel via
   * `ctx.isCancelled()` between chunks. A thrown error is reported to the host
   * as `{ type: "error" }` — it never becomes an unhandled rejection.
   *
   * Buffers returned in `transfer` are transferred with the `done` message
   * (and detached inside the worker), so return every result array that the
   * worker no longer needs.
   */
  run: (
    job: TJob,
    ctx: WorkloadWorkerContext,
  ) => Promise<{ result: TResult; transfer?: Transferable[] }>;
  /**
   * Re-post the **last** progress payload this often while a job runs, so a
   * host-side stall watch does not fire during a long silent stretch.
   *
   * The heartbeat repeats real progress and never invents a percentage, so no
   * beat is sent until the job has called `ctx.reportProgress` at least once.
   * And, like any worker timer, a beat can only land when the job yields to the
   * worker event loop: a fully synchronous WASM call blocks the heartbeat as
   * well, and the pending beat arrives once that call returns.
   *
   * Default 8 s; set 0 to disable.
   */
  heartbeatMs?: number;
}

declare const self: DedicatedWorkerGlobalScope;

/** Default: frequent enough that a 2-minute stall watch rarely false-fires. */
const DEFAULT_HEARTBEAT_MS = 8_000;

/**
 * Install the standard run/cancel/ready loop on `self`, then post
 * `{ type: "ready" }` so the host's `whenReady()` resolves.
 *
 * Call it exactly once per worker module: it assigns `self.onmessage`, so a
 * second call replaces the first handler. Every `run` request is started as it
 * arrives — there is no queue — and only the newest job is tracked as active,
 * so cancel and the heartbeat apply to that one. Keep one job in flight per
 * worker (spawn another worker for parallelism) or an older job becomes
 * uncancellable.
 */
export function installWorkloadHandler<TJob, TResult>(
  options: WorkloadHandlerOptions<TJob, TResult>,
): void {
  let cancelId: number | null = null;
  let activeId: number | null = null;
  const heartbeatMs =
    options.heartbeatMs === undefined
      ? DEFAULT_HEARTBEAT_MS
      : options.heartbeatMs;

  function post(msg: WorkloadResponse, transfer?: Transferable[]): void {
    if (transfer && transfer.length > 0) {
      self.postMessage(msg, transfer);
    } else {
      self.postMessage(msg);
    }
  }

  self.onmessage = (ev: MessageEvent<WorkloadRequest<TJob>>) => {
    const msg = ev.data;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "cancel") {
      if (activeId === msg.id) {
        cancelId = msg.id;
      }
      return;
    }

    if (msg.type !== "run") return;

    const { id, job } = msg;
    activeId = id;
    cancelId = null;

    void (async () => {
      let lastProgress: unknown = null;
      let hb: ReturnType<typeof setInterval> | null = null;
      if (heartbeatMs > 0) {
        hb = setInterval(() => {
          if (activeId !== id || lastProgress == null) return;
          // Re-emit last known progress so the UI stall watch resets.
          post({ type: "progress", id, progress: lastProgress });
        }, heartbeatMs);
      }
      try {
        const { result, transfer } = await options.run(job, {
          id,
          isCancelled: () => cancelId === id,
          reportProgress: (progress) => {
            lastProgress = progress;
            post({ type: "progress", id, progress });
          },
        });
        post(
          { type: "done", id, result },
          transfer && transfer.length > 0 ? transfer : undefined,
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err ?? "Workload failed");
        post({ type: "error", id, message });
      } finally {
        if (hb != null) clearInterval(hb);
        if (activeId === id) activeId = null;
      }
    })();
  };

  post({ type: "ready" });
}
