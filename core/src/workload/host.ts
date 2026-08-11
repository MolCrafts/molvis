/**
 * Main-thread host for a long-lived Dedicated Worker workload.
 *
 * One worker realm with its own imports (often its own WebAssembly module),
 * jobs correlated by id, `Transferable` payloads (buffers moved instead of
 * copied), a cancel flag, and a progress stream. Domain packages only supply
 * job/result types and a worker URL.
 *
 * Many jobs may be outstanding at once, but the worker side runs them
 * first-in-first-out (FIFO), one at a time — see `./worker_side`.
 */

import type { WorkloadRequest, WorkloadResponse } from "./protocol";
import { isWorkloadResponse } from "./protocol";

export interface WorkloadHostOptions {
  /** Short name for the worker (`name` option + error prefixes). */
  name: string;
  /**
   * Spawn the worker. Keep the static `new Worker(new URL("./worker.js",
   * import.meta.url))` form inside the factory so the host bundler folds
   * the worker chunk. Tests inject a fake worker here.
   */
  createWorker?: () => Worker;
  /**
   * Worker script URL for non-bundled hosts that cannot supply
   * {@link WorkloadHostOptions.createWorker}. One of the two must be set;
   * the constructor throws when both are missing.
   */
  workerUrl?: URL | string;
  /**
   * Default poll interval for {@link WorkloadRunOptions.shouldCancel}, in
   * milliseconds. Defaults to 100 ms; a single job may override it.
   */
  cancelPollMs?: number;
}

/** Per-job knobs for {@link WorkloadHost.run}. */
export interface WorkloadRunOptions<TProgress = unknown> {
  /**
   * Transfer ownership of these buffers with the job instead of copying them.
   * Every listed buffer is **detached** on this thread once the job is
   * posted — do not read the backing arrays afterwards.
   */
  transfer?: Transferable[];
  /** Called for each `progress` message the worker streams for this job. */
  onProgress?: (progress: TProgress) => void;
  /**
   * Polled from the moment the job is posted until it settles (see
   * {@link WorkloadRunOptions.cancelPollMs}) — including while it waits its turn
   * in the worker's queue, so a job can be cancelled before it ever starts.
   *
   * The first `true` posts exactly one `cancel` for this job and stops the
   * poll; the job still settles through its own `done` / `error` message, so
   * cancelling does not reject {@link WorkloadHost.run}.
   */
  shouldCancel?: () => boolean;
  /** Poll interval for this job (ms). Falls back to the host default. */
  cancelPollMs?: number;
}

type Pending<TResult, TProgress> = {
  resolve: (r: TResult) => void;
  reject: (e: Error) => void;
  onProgress?: (p: TProgress) => void;
  cancelTimer: ReturnType<typeof setInterval> | null;
};

function assertWorkerCtor(): typeof Worker {
  if (typeof Worker === "undefined") {
    throw new Error("Dedicated Workers are not available in this environment.");
  }
  return Worker;
}

/**
 * Generic multi-job worker client. One host ↔ one worker script.
 *
 * **Preferred** — keep the static `new Worker(new URL(…))` form in the
 * `createWorker` factory so the bundler emits a worker chunk:
 *
 * ```ts
 * const host = new WorkloadHost({
 *   name: "compute",
 *   createWorker: () =>
 *     new Worker(new URL("./worker.js", import.meta.url), {
 *       type: "module",
 *       name: "compute",
 *     }),
 * });
 * ```
 *
 * Do **not** pass a pre-built `URL` variable into `new Worker(url)` inside a
 * library and expect the app bundler to rewrite it — rspack only analyzes
 * the static `new Worker(new URL(...))` form.
 *
 * @see https://rspack.rs/guide/features/web-workers
 */
export class WorkloadHost<TJob, TResult, TProgress = unknown> {
  readonly name: string;
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending<TResult, TProgress>>();
  private ready: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private readySettled = false;
  private dead = false;
  private readonly defaultCancelPollMs: number;

  constructor(options: WorkloadHostOptions) {
    this.name = options.name;
    this.defaultCancelPollMs = options.cancelPollMs ?? 100;

    if (options.createWorker) {
      this.worker = options.createWorker();
    } else if (options.workerUrl != null) {
      // Last-resort for non-bundled hosts only. Prefer createWorker.
      const W = assertWorkerCtor();
      this.worker = new W(options.workerUrl, {
        type: "module",
        name: options.name,
      });
    } else {
      throw new Error(
        `[${options.name}] WorkloadHost needs createWorker or workerUrl.`,
      );
    }

    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // Avoid unhandled rejection if nobody awaits whenReady before a crash.
    this.ready.catch(() => {
      /* settled via failAll / whenReady */
    });

    this.worker.onmessage = (ev: MessageEvent<unknown>) => {
      this.onMessage(ev.data);
    };
    this.worker.onerror = (ev) => {
      this.failAll(
        new Error(`[${this.name}] worker error: ${ev.message || "unknown"}`),
      );
    };
  }

  /**
   * Resolves once the worker has posted `{ type: "ready" }` — its module graph
   * (and any WASM it imports) is live and the first job will not pay boot cost.
   *
   * Rejects if the worker errors or the host is disposed before that. Always
   * the same promise, and it settles exactly once per host, so callers may
   * await it as often as they like.
   */
  whenReady(): Promise<void> {
    return this.ready;
  }

  /**
   * True once the worker errored or {@link WorkloadHost.dispose} ran. A dead
   * host is not reusable — {@link WorkloadHost.run} throws immediately.
   */
  get isDead(): boolean {
    return this.dead;
  }

  private onMessage(raw: unknown): void {
    if (!isWorkloadResponse(raw)) return;
    const msg = raw as WorkloadResponse<TResult, TProgress>;

    if (msg.type === "ready") {
      this.settleReady();
      return;
    }

    const p = this.pending.get(msg.id);
    if (!p) return;

    if (msg.type === "progress") {
      p.onProgress?.(msg.progress);
      return;
    }
    if (msg.type === "done") {
      this.clearPending(msg.id);
      p.resolve(msg.result);
      return;
    }
    if (msg.type === "error") {
      this.clearPending(msg.id);
      p.reject(new Error(msg.message));
    }
  }

  private clearPending(id: number): void {
    const p = this.pending.get(id);
    if (p?.cancelTimer != null) {
      clearInterval(p.cancelTimer);
    }
    this.pending.delete(id);
  }

  private settleReady(err?: Error): void {
    if (this.readySettled) return;
    this.readySettled = true;
    if (err) {
      this.readyReject?.(err);
    } else {
      this.readyResolve?.();
    }
    this.readyResolve = null;
    this.readyReject = null;
  }

  private failAll(err: Error): void {
    this.settleReady(err);
    for (const [id, p] of this.pending) {
      if (p.cancelTimer != null) clearInterval(p.cancelTimer);
      p.reject(err);
      this.pending.delete(id);
    }
    this.dead = true;
  }

  /**
   * Run one job and resolve with the worker's result.
   *
   * Waits for the ready handshake first, then posts
   * `{ type: "run", id, job }`. Buffers listed in
   * {@link WorkloadRunOptions.transfer} travel by transfer, so they are
   * detached on this thread as soon as the job is posted; everything else is
   * structured-cloned. Many jobs may be outstanding at once — replies are
   * matched by the id assigned here — but the worker executes them
   * first-in-first-out (FIFO), one at a time, so a job posted while another runs
   * waits its turn and this promise stays pending until then.
   *
   * Cancellation is cooperative: when
   * {@link WorkloadRunOptions.shouldCancel} is given it is polled, and the
   * first `true` posts one `cancel` and stops the poll. The promise is left to
   * settle through the worker's own reply, so a cancelled job normally
   * *resolves* with whatever partial result the job chose to report.
   *
   * @param job domain payload for the worker's `run` implementation
   * @returns the `result` field of the worker's `{ type: "done" }` message
   * @throws Error when the host is already dead (worker error or
   *   {@link WorkloadHost.dispose}); when `dispose()` lands while this call is
   *   still awaiting the handshake; when the handshake itself fails (worker
   *   script or WASM failed to load); when the job cannot be posted (not
   *   structured-cloneable); and with the worker's own message when the job
   *   answers `{ type: "error" }`.
   */
  async run(
    job: TJob,
    options: WorkloadRunOptions<TProgress> = {},
  ): Promise<TResult> {
    if (this.dead) {
      throw new Error(
        `[${this.name}] worker is dead; create a new host or reload.`,
      );
    }
    await this.ready;
    // dispose() may land while awaiting ready; registering on a terminated
    // worker would never settle.
    if (this.dead) {
      throw new Error(`[${this.name}] worker disposed while starting.`);
    }
    const id = this.nextId++;

    return new Promise<TResult>((resolve, reject) => {
      const pending: Pending<TResult, TProgress> = {
        resolve,
        reject,
        onProgress: options.onProgress,
        cancelTimer: null,
      };
      this.pending.set(id, pending);

      if (options.shouldCancel) {
        const ms = options.cancelPollMs ?? this.defaultCancelPollMs;
        pending.cancelTimer = setInterval(() => {
          if (options.shouldCancel?.()) {
            // One cancel per job — the worker exits at its next cooperative
            // checkpoint; re-posting every tick is protocol noise.
            if (pending.cancelTimer != null) {
              clearInterval(pending.cancelTimer);
              pending.cancelTimer = null;
            }
            this.cancel(id);
          }
        }, ms);
      }

      const req: WorkloadRequest<TJob> = { type: "run", id, job };
      try {
        const transfer = options.transfer ?? [];
        if (transfer.length > 0) {
          this.worker.postMessage(req, transfer);
        } else {
          this.worker.postMessage(req);
        }
      } catch (err) {
        this.clearPending(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Ask the worker to stop job `id` at its next cooperative checkpoint.
   *
   * Fire-and-forget: the pending {@link WorkloadHost.run} promise is left
   * alone — the job is expected to answer `done` with a partial result (the
   * optimize job returns its last coordinates and `cancelled: true`).
   * Cancelling an unknown or already-finished id is harmless, and a cancel for
   * a job still queued in the worker survives until that job starts, which then
   * sees the flag on its first poll.
   */
  cancel(id: number): void {
    const req: WorkloadRequest = { type: "cancel", id };
    this.worker.postMessage(req);
  }

  /**
   * Terminate the worker, reject every in-flight job and any pending
   * {@link WorkloadHost.whenReady}, and mark the host dead so later
   * {@link WorkloadHost.run} calls throw instead of hanging. Not reusable:
   * build a new host, or let {@link createWorkloadSingleton} respawn one.
   */
  dispose(): void {
    this.failAll(new Error(`[${this.name}] host disposed`));
    this.worker.terminate();
    this.dead = true;
  }
}

/**
 * Lazy process-wide singleton host for a named workload.
 * Callers pass a factory so each domain owns its worker URL.
 *
 * @param factory builds a fresh host — called on the first `get()`, and again
 *   whenever the previous host died (worker error or `dispose()`)
 * @returns `get()` for the live host (respawning a dead one), and
 *   `setForTests(host)` to install a fake; either form first disposes the host
 *   it replaces, and `setForTests(null)` drops back to lazy `factory()` spawn
 */
export function createWorkloadSingleton<TJob, TResult, TProgress = unknown>(
  factory: () => WorkloadHost<TJob, TResult, TProgress>,
): {
  get: () => WorkloadHost<TJob, TResult, TProgress>;
  setForTests: (host: WorkloadHost<TJob, TResult, TProgress> | null) => void;
} {
  let instance: WorkloadHost<TJob, TResult, TProgress> | null = null;
  return {
    get() {
      if (!instance || instance.isDead) {
        instance = factory();
      }
      return instance;
    },
    setForTests(host) {
      if (instance && host !== instance) {
        try {
          instance.dispose();
        } catch {
          /* */
        }
      }
      instance = host;
    },
  };
}
