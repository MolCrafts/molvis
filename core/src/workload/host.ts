/**
 * Main-thread host for a long-lived Dedicated Worker workload.
 *
 * One worker realm with its own imports (often its own WebAssembly (WASM)
 * module),
 * jobs correlated by id, `Transferable` payloads (buffers moved instead of
 * copied), a cancel flag, and a progress stream. Domain packages only supply
 * job/result types and a worker URL.
 *
 * Many jobs may be outstanding at once, but the worker side runs them
 * first-in-first-out (FIFO), one at a time — see `./worker_side`.
 */

import type { WorkloadRequest, WorkloadResponse } from "./protocol";
import { isWorkloadResponse } from "./protocol";

/**
 * Constructor options for {@link WorkloadHost}. `THostCall` / `THostReply`
 * type the optional worker-initiated host-call channel — see
 * {@link WorkloadHostOptions.onHostCall}.
 */
export interface WorkloadHostOptions<
  THostCall = unknown,
  THostReply = unknown,
> {
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
  /**
   * Hard deadline for the ready handshake, in milliseconds. When set and the
   * worker has not posted `{ type: "ready" }` within the window,
   * {@link WorkloadHost.whenReady} rejects with a `[name]`-prefixed timeout
   * error and every in-flight job fails through the usual crash path
   * (`failAll`) — the host is dead afterwards. **Unset (the default) means no
   * timer at all**: `whenReady` stays pending as long as the worker does. The
   * timer is cleared the moment the handshake settles either way.
   */
  readyTimeoutMs?: number;
  /**
   * Answers worker-initiated `host-call` messages. The worker's opaque
   * `call` payload is passed through untouched; the returned `result` is
   * posted back as `{ type: "host-reply", callId, ok: true, result }`, with
   * `transfer` forwarded as the postMessage transfer list (zero-copy for
   * byte payloads). If the handler throws — or none is configured — the host
   * replies `ok: false` with a `[name]`-prefixed error string so the
   * worker-side promise rejects instead of hanging.
   */
  onHostCall?: (
    call: THostCall,
  ) => Promise<{ result: THostReply; transfer?: Transferable[] }>;
}

/**
 * Handle for one submitted job — see {@link WorkloadHost.submit}.
 *
 * `result` is the caller-facing promise: it settles at the terminal message,
 * or earlier when {@link WorkloadRunOptions.earlyResolve} matches, or rejects
 * with {@link WorkloadCancelledError} under `cancelMode: "reject"`.
 * `completion` always waits for the job's terminal `done` / `error` message
 * (except reject-cancel, which rejects it immediately — a `result` already
 * settled by `earlyResolve` keeps its value). Both promises carry an
 * internal no-op catch, so consuming only one of them never leaks an
 * unhandled rejection.
 */
export type WorkloadJobTicket<TResult> = {
  /** Job id — pass to {@link WorkloadHost.cancel} to stop this job. */
  id: number;
  /** Settles early (earlyResolve) or with the terminal message. */
  result: Promise<TResult>;
  /** Settles only at the job's terminal `done` / `error` message. */
  completion: Promise<TResult>;
};

/**
 * Rejection value for jobs cancelled under
 * {@link WorkloadRunOptions.cancelMode} `"reject"`.
 */
export class WorkloadCancelledError extends Error {
  /** Id of the cancelled job. */
  readonly jobId: number;

  constructor(hostName: string, jobId: number) {
    super(`[${hostName}] job ${jobId} was cancelled`);
    this.name = "WorkloadCancelledError";
    this.jobId = jobId;
  }
}

/** Per-job knobs for {@link WorkloadHost.run} / {@link WorkloadHost.submit}. */
export interface WorkloadRunOptions<TProgress = unknown, TResult = unknown> {
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
   * poll. What the promises do next follows
   * {@link WorkloadRunOptions.cancelMode}: under the default
   * `"resolve-partial"` the job still settles through its own `done` /
   * `error` message, so cancelling does not reject
   * {@link WorkloadHost.run}; under `"reject"` both ticket promises reject
   * with {@link WorkloadCancelledError} the moment the poll fires.
   */
  shouldCancel?: () => boolean;
  /** Poll interval for this job (ms). Falls back to the host default. */
  cancelPollMs?: number;
  /**
   * Called on every `progress` message for this job. The first call that
   * returns a value other than `undefined` resolves the ticket's `result`
   * promise early with that value; the job keeps running and its pending
   * entry stays registered, so later progress still reaches
   * {@link WorkloadRunOptions.onProgress} and `completion` still settles at
   * the terminal message. Without this option, `result` and `completion`
   * settle together — exactly the classic {@link WorkloadHost.run} semantics.
   */
  earlyResolve?: (progress: TProgress) => TResult | undefined;
  /**
   * What cancelling this job (via {@link WorkloadRunOptions.shouldCancel} or
   * {@link WorkloadHost.cancel}) does to the ticket's promises.
   *
   * - `"resolve-partial"` (the default): today's behavior — one `cancel` is
   *   posted and both promises wait for the worker's own terminal message,
   *   so a cancelled job normally *resolves* with a partial result.
   * - `"reject"`: the moment cancel fires, `result` and `completion` reject
   *   with {@link WorkloadCancelledError} (a `result` already settled via
   *   `earlyResolve` stays settled) and the job leaves the pending
   *   map; a late `done` / `error` from the worker is dropped by the
   *   unknown-id rule. The cancel message is still posted so the worker
   *   stops wasting cycles.
   */
  cancelMode?: "resolve-partial" | "reject";
}

type Pending<TResult, TProgress> = {
  resolveResult: (r: TResult) => void;
  rejectResult: (e: Error) => void;
  resolveCompletion: (r: TResult) => void;
  rejectCompletion: (e: Error) => void;
  /** True once earlyResolve fired — stop calling it on later progress. */
  resultSettled: boolean;
  earlyResolve?: (p: TProgress) => TResult | undefined;
  cancelMode: "resolve-partial" | "reject";
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
export class WorkloadHost<
  TJob,
  TResult,
  TProgress = unknown,
  THostCall = unknown,
  THostReply = unknown,
> {
  readonly name: string;
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending<TResult, TProgress>>();
  private ready: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private readySettled = false;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private dead = false;
  private readonly defaultCancelPollMs: number;
  private readonly onHostCall?: (
    call: THostCall,
  ) => Promise<{ result: THostReply; transfer?: Transferable[] }>;

  constructor(options: WorkloadHostOptions<THostCall, THostReply>) {
    this.name = options.name;
    this.defaultCancelPollMs = options.cancelPollMs ?? 100;
    this.onHostCall = options.onHostCall;

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

    if (options.readyTimeoutMs != null) {
      const ms = options.readyTimeoutMs;
      this.readyTimer = setTimeout(() => {
        this.failAll(
          new Error(`[${this.name}] worker failed to start within ${ms}ms`),
        );
      }, ms);
    }
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
    const msg = raw as WorkloadResponse<TResult, TProgress, THostCall>;

    if (msg.type === "ready") {
      this.settleReady();
      return;
    }
    // host-call carries a callId, not a job id — branch before the pending
    // lookup.
    if (msg.type === "host-call") {
      void this.dispatchHostCall(msg.callId, msg.call);
      return;
    }

    const p = this.pending.get(msg.id);
    if (!p) return;

    if (msg.type === "progress") {
      p.onProgress?.(msg.progress);
      if (p.earlyResolve && !p.resultSettled) {
        const early = p.earlyResolve(msg.progress);
        if (early !== undefined) {
          p.resultSettled = true;
          p.resolveResult(early);
        }
      }
      return;
    }
    if (msg.type === "done") {
      this.clearPending(msg.id);
      p.resolveResult(msg.result);
      p.resolveCompletion(msg.result);
      return;
    }
    if (msg.type === "error") {
      this.clearPending(msg.id);
      const err = new Error(msg.message);
      p.rejectResult(err);
      p.rejectCompletion(err);
    }
  }

  /**
   * Answer one worker-initiated host-call. A reply is only ever posted in
   * response to a live worker message, so it cannot hit the pre-init message
   * drop; failures (handler threw, or no handler configured) go back as
   * `ok: false` so the worker-side promise rejects instead of hanging.
   */
  private async dispatchHostCall(
    callId: number,
    call: THostCall,
  ): Promise<void> {
    const handler = this.onHostCall;
    if (!handler) {
      const reply: WorkloadRequest<TJob, THostReply> = {
        type: "host-reply",
        callId,
        ok: false,
        error: `[${this.name}] no onHostCall handler configured`,
      };
      this.worker.postMessage(reply);
      return;
    }
    try {
      const { result, transfer } = await handler(call);
      const reply: WorkloadRequest<TJob, THostReply> = {
        type: "host-reply",
        callId,
        ok: true,
        result,
      };
      if (transfer && transfer.length > 0) {
        this.worker.postMessage(reply, transfer);
      } else {
        this.worker.postMessage(reply);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reply: WorkloadRequest<TJob, THostReply> = {
        type: "host-reply",
        callId,
        ok: false,
        error: `[${this.name}] ${message}`,
      };
      this.worker.postMessage(reply);
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
    if (this.readyTimer != null) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
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
      p.rejectResult(err);
      p.rejectCompletion(err);
      this.pending.delete(id);
    }
    this.dead = true;
  }

  /**
   * Run one job and resolve with the worker's result. Sugar for
   * {@link WorkloadHost.submit} — `submit(job, options).result` — with the
   * classic signature and semantics.
   *
   * Waits for the ready handshake first, then posts
   * `{ type: "run", id, job }`. Buffers listed in
   * {@link WorkloadRunOptions.transfer} travel by transfer, so they are
   * detached on this thread as soon as the job is posted; everything else is
   * structured-cloned. Many jobs may be outstanding at once — replies are
   * matched by the id assigned here — but the worker executes them
   * FIFO, one at a time, so a job posted while another runs
   * waits its turn and this promise stays pending until then.
   *
   * Cancellation is cooperative: when
   * {@link WorkloadRunOptions.shouldCancel} is given it is polled, and the
   * first `true` posts one `cancel` and stops the poll. Under the default
   * {@link WorkloadRunOptions.cancelMode} `"resolve-partial"` the promise is
   * left to settle through the worker's own reply, so a cancelled job
   * normally *resolves* with whatever partial result the job chose to
   * report; under `"reject"` it rejects with {@link WorkloadCancelledError}
   * instead.
   *
   * @param job domain payload for the worker's `run` implementation
   * @returns the `result` field of the worker's `{ type: "done" }` message
   * @throws Error when the host is already dead (worker error or
   *   {@link WorkloadHost.dispose}); when `dispose()` lands while this call is
   *   still awaiting the handshake; when the handshake itself fails (worker
   *   script or WASM failed to load); when the job cannot be posted (not
   *   structured-cloneable); and with the worker's own message when the job
   *   answers `{ type: "error" }`.
   * @throws WorkloadCancelledError when the job was submitted with
   *   {@link WorkloadRunOptions.cancelMode} `"reject"` and a cancel fired.
   */
  async run(
    job: TJob,
    options: WorkloadRunOptions<TProgress, TResult> = {},
  ): Promise<TResult> {
    return this.submit(job, options).result;
  }

  /**
   * Submit one job and get a {@link WorkloadJobTicket} back synchronously.
   *
   * The id is assigned here (before the ready handshake), so the caller can
   * hold it for {@link WorkloadHost.cancel} — e.g. latest-wins request
   * dropping. The job itself is posted once the handshake resolves, exactly
   * like {@link WorkloadHost.run}; transfer, progress, and cancel-poll
   * semantics are unchanged. On top of that:
   *
   * - {@link WorkloadRunOptions.earlyResolve} can settle `result` on a
   *   progress message while `completion` waits for the terminal one.
   * - {@link WorkloadRunOptions.cancelMode} `"reject"` makes a cancel reject
   *   both promises with {@link WorkloadCancelledError} at once (a `result`
   *   already settled via `earlyResolve` keeps its value).
   *
   * Both ticket promises carry a no-op catch, so ignoring either never leaks
   * an unhandled rejection. A dead host yields a ticket whose promises are
   * already rejected.
   */
  submit(
    job: TJob,
    options: WorkloadRunOptions<TProgress, TResult> = {},
  ): WorkloadJobTicket<TResult> {
    const id = this.nextId++;
    if (this.dead) {
      const err = new Error(
        `[${this.name}] worker is dead; create a new host or reload.`,
      );
      const rejected = Promise.reject<TResult>(err);
      rejected.catch(() => {
        /* consumed via the ticket */
      });
      return { id, result: rejected, completion: rejected };
    }

    let resolveResult!: (r: TResult) => void;
    let rejectResult!: (e: Error) => void;
    let resolveCompletion!: (r: TResult) => void;
    let rejectCompletion!: (e: Error) => void;
    const result = new Promise<TResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const completion = new Promise<TResult>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    // Callers may consume only one of the two — the other must not surface
    // as an unhandled rejection (same trick as the ready promise).
    result.catch(() => {
      /* settled via the ticket */
    });
    completion.catch(() => {
      /* settled via the ticket */
    });

    const pending: Pending<TResult, TProgress> = {
      resolveResult,
      rejectResult,
      resolveCompletion,
      rejectCompletion,
      resultSettled: false,
      earlyResolve: options.earlyResolve,
      cancelMode: options.cancelMode ?? "resolve-partial",
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

    void this.postJob(id, job, options.transfer);
    return { id, result, completion };
  }

  /**
   * Post the job once the ready handshake settles. If the handshake fails or
   * dispose() lands first, `failAll` has already rejected this job's pending
   * entry — nothing to do here.
   */
  private async postJob(
    id: number,
    job: TJob,
    transfer: Transferable[] | undefined,
  ): Promise<void> {
    try {
      await this.ready;
    } catch {
      return;
    }
    if (this.dead) return;
    const req: WorkloadRequest<TJob, THostReply> = { type: "run", id, job };
    try {
      if (transfer && transfer.length > 0) {
        this.worker.postMessage(req, transfer);
      } else {
        this.worker.postMessage(req);
      }
    } catch (err) {
      const p = this.pending.get(id);
      this.clearPending(id);
      if (p) {
        const e = err instanceof Error ? err : new Error(String(err));
        p.rejectResult(e);
        p.rejectCompletion(e);
      }
    }
  }

  /**
   * Ask the worker to stop job `id` at its next cooperative checkpoint.
   *
   * The cancel message is always posted so the worker stops wasting cycles;
   * what happens to the job's promises follows the
   * {@link WorkloadRunOptions.cancelMode} it was submitted with:
   *
   * - `"resolve-partial"` (default): fire-and-forget — the promises are left
   *   alone and the job is expected to answer `done` with a partial result
   *   (the optimize job returns its last coordinates and `cancelled: true`).
   * - `"reject"`: both ticket promises reject immediately with
   *   {@link WorkloadCancelledError} (an already-settled `result` keeps its
   *   value) and the job leaves the pending map; a late `done` / `error` is
   *   dropped by the unknown-id rule.
   *
   * Cancelling an unknown or already-finished id is harmless, and a cancel for
   * a job still queued in the worker survives until that job starts, which then
   * sees the flag on its first poll.
   */
  cancel(id: number): void {
    const req: WorkloadRequest = { type: "cancel", id };
    this.worker.postMessage(req);
    const p = this.pending.get(id);
    if (p && p.cancelMode === "reject") {
      this.clearPending(id);
      const err = new WorkloadCancelledError(this.name, id);
      p.rejectResult(err);
      p.rejectCompletion(err);
    }
  }

  /**
   * Terminate the worker, reject every in-flight job and any pending
   * {@link WorkloadHost.whenReady}, and mark the host dead so later
   * {@link WorkloadHost.run} calls throw instead of hanging. Not reusable:
   * build a new host, or let {@link createWorkloadSingleton} respawn one.
   */
  dispose(): void {
    // failAll already marks the host dead.
    this.failAll(new Error(`[${this.name}] host disposed`));
    this.worker.terminate();
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
