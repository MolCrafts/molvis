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

/**
 * The slice of `DedicatedWorkerGlobalScope` that
 * {@link installWorkloadHandler} touches.
 *
 * Exists so a unit test can drive the handler with a plain object instead of a
 * real worker global — production callers pass nothing and get `self`.
 */
export interface WorkloadWorkerScope<TJob> {
  onmessage: ((ev: MessageEvent<WorkloadRequest<TJob>>) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
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
 * Install the standard run/cancel/ready loop on the worker global, then post
 * `{ type: "ready" }` so the host's `whenReady()` resolves.
 *
 * Call it exactly once per worker module: it assigns `scope.onmessage`, so a
 * second call replaces the first handler.
 *
 * **Jobs execute first-in-first-out (FIFO), one at a time.** A `run` request is
 * queued in arrival order and its `run` implementation is not invoked until the
 * previous job has posted `done` or `error` — one heavy WASM (WebAssembly) job
 * per worker realm, which is what keeps two big allocations from meeting in the
 * same heap. Spawn another worker for parallelism.
 *
 * **Cancel is per job, and never too early.** A `cancel` is remembered for its
 * id whether the job is running, still queued, or the id is unknown, so
 * `ctx.isCancelled()` is already true on a queued job's first poll and it can
 * skip the work entirely. The flag is dropped when that job settles.
 *
 * @param options the domain `run` implementation, plus the heartbeat interval
 * @param scope where to install, defaulting to the worker global. It exists for
 *   unit tests, which pass a plain {@link WorkloadWorkerScope} so the loop runs
 *   with no real worker; production worker modules omit it.
 */
export function installWorkloadHandler<TJob, TResult>(
  options: WorkloadHandlerOptions<TJob, TResult>,
  scope: WorkloadWorkerScope<TJob> = self,
): void {
  /** Ids the host asked to cancel, kept until the job they name settles. */
  const cancelled = new Set<number>();
  /** FIFO queue: the tail of the chain of jobs run so far. */
  let chain: Promise<void> = Promise.resolve();
  const heartbeatMs =
    options.heartbeatMs === undefined
      ? DEFAULT_HEARTBEAT_MS
      : options.heartbeatMs;

  function post(msg: WorkloadResponse, transfer?: Transferable[]): void {
    if (transfer && transfer.length > 0) {
      scope.postMessage(msg, transfer);
    } else {
      scope.postMessage(msg);
    }
  }

  async function executeJob(id: number, job: TJob): Promise<void> {
    let lastProgress: unknown = null;
    let settled = false;
    let hb: ReturnType<typeof setInterval> | null = null;
    if (heartbeatMs > 0) {
      hb = setInterval(() => {
        if (settled || lastProgress == null) return;
        // Re-emit last known progress so the UI stall watch resets.
        post({ type: "progress", id, progress: lastProgress });
      }, heartbeatMs);
    }
    try {
      const { result, transfer } = await options.run(job, {
        id,
        isCancelled: () => cancelled.has(id),
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
      settled = true;
      if (hb != null) clearInterval(hb);
      cancelled.delete(id);
    }
  }

  scope.onmessage = (ev: MessageEvent<WorkloadRequest<TJob>>) => {
    const msg = ev.data;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "cancel") {
      cancelled.add(msg.id);
      return;
    }

    if (msg.type !== "run") return;

    const { id, job } = msg;
    // Keep the chain resolved: a rejected tail would skip every later job's
    // `.then` and leave the host waiting forever. `executeJob` already reports
    // its own failures as `{ type: "error" }`.
    chain = chain.then(() => executeJob(id, job)).catch(() => {});
  };

  post({ type: "ready" });
}
