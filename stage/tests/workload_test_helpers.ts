/**
 * Shared fake compute worker for the main-thread workload clients
 * (`optimize/worker_client`, `analysis/worker_client`) and for the callers
 * that sit on top of them (`optimize/structure`).
 *
 * Every one of those suites needs the same three things:
 *
 *   1. An object that implements as much of `Worker` as `WorkloadHost`
 *      touches (`onmessage`, `onerror`, `postMessage`, `terminate`) so no real
 *      DedicatedWorker, worker chunk, or worker-side WASM is involved.
 *   2. A per-job script hook, so each suite decides what the worker answers.
 *   3. A real `WorkloadHost` wired over it and injected with
 *      `setComputeRuntimeForTests`.
 *
 * Centralizing here keeps each test file focused on its own assertions
 * (same reason as `core/tests/opfs_test_helpers.ts`).
 */

import {
  WorkloadHost,
  type WorkloadRequest,
  type WorkloadResponse,
} from "@molcrafts/molvis-core/workload";
import type {
  ComputeJob,
  ComputeProgress,
  ComputeResult,
} from "../src/compute/protocol";
import { setComputeRuntimeForTests } from "../src/compute/runtime";

/** What a scripted fake worker may do for one job. */
export interface JobScriptContext {
  id: number;
  job: ComputeJob;
  /** Post a worker → main envelope. */
  emit: (msg: WorkloadResponse) => void;
  /** Repeat `fn` every `ms`; cleared on cancel, stop, or terminate. */
  every: (ms: number, fn: () => void) => void;
  /** Clear this worker's timers. */
  stop: () => void;
  /** Run `fn` when the host posts `{ type: "cancel", id }`. */
  onCancel: (fn: () => void) => void;
}

/** One job's worth of scripted worker behaviour. */
export type ComputeJobScript = (ctx: JobScriptContext) => void;

/**
 * Minimal in-process fake worker: implements the workload protocol on the
 * main thread, so a runtime is exercised with no real DedicatedWorker,
 * no worker chunk, and no WASM. Shape mirrors what `WorkloadHost` touches
 * (`onmessage`, `onerror`, `postMessage`, `terminate`).
 */
export class ScriptedComputeWorker extends EventTarget {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  /** Job ids the host asked to cancel, in arrival order. */
  readonly cancelledIds: number[] = [];
  private readonly timers = new Set<ReturnType<typeof setInterval>>();
  private readonly cancelHandlers = new Map<number, () => void>();

  constructor(private readonly script: ComputeJobScript) {
    super();
  }

  postMessage(data: WorkloadRequest<ComputeJob>, _transfer?: unknown): void {
    if (data.type === "cancel") {
      this.cancelledIds.push(data.id);
      const handler = this.cancelHandlers.get(data.id);
      if (!handler) return;
      this.cancelHandlers.delete(data.id);
      this.clearTimers();
      queueMicrotask(handler);
      return;
    }
    if (data.type !== "run") return;
    const { id, job } = data;
    queueMicrotask(() => {
      this.script({
        id,
        job,
        emit: (msg) => this.emit(msg),
        every: (ms, fn) => {
          this.timers.add(setInterval(fn, ms));
        },
        stop: () => this.clearTimers(),
        onCancel: (fn) => {
          this.cancelHandlers.set(id, fn);
        },
      });
    });
  }

  terminate(): void {
    this.clearTimers();
    this.cancelHandlers.clear();
  }

  /** Signal ready after the host attaches its listeners. */
  signalReady(): void {
    queueMicrotask(() => {
      this.emit({ type: "ready" });
    });
  }

  private clearTimers(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers.clear();
  }

  private emit(msg: WorkloadResponse): void {
    const ev = { data: msg } as MessageEvent;
    this.onmessage?.(ev);
  }
}

/** Knobs the suites differ on. */
export interface ScriptedComputeHostOptions {
  /**
   * Host-level cancel poll interval (ms). Omit for the production default
   * (100 ms); a mid-run cancel test wants it short.
   */
  cancelPollMs?: number;
}

/**
 * Install a real `WorkloadHost` driven by a scripted fake worker, and return
 * the fake so a test can inspect what the host posted (`cancelledIds`).
 *
 * The caller is responsible for `setComputeRuntimeForTests(null)` in
 * `afterEach` — that disposes the host, which terminates the fake and clears
 * its timers.
 */
export function installScriptedComputeHost(
  script: ComputeJobScript,
  options: ScriptedComputeHostOptions = {},
): ScriptedComputeWorker {
  const fake = new ScriptedComputeWorker(script);
  const host = new WorkloadHost<ComputeJob, ComputeResult, ComputeProgress>({
    name: "test-compute",
    createWorker: () => {
      fake.signalReady();
      return fake as unknown as Worker;
    },
    cancelPollMs: options.cancelPollMs,
  });
  setComputeRuntimeForTests(host);
  return fake;
}
