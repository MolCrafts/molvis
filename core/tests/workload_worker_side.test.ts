import { describe, expect, it } from "@rstest/core";
import {
  installWorkloadHandler,
  isWorkloadResponse,
  type WorkloadRequest,
  type WorkloadResponse,
  type WorkloadWorkerScope,
} from "../src/workload";

interface TestJob {
  n: number;
}

interface TestResult {
  id: number;
}

/** A promise plus its resolver — the only clock these tests use. */
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Drain the microtask queue. Determinism rule: no wall-clock timers, so job
 * ordering is driven by microtasks and explicit deferreds only.
 */
async function flush(turns = 16): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

/**
 * A plain {@link WorkloadWorkerScope} in place of the worker global: the
 * handler installs its `onmessage` here and posts into `posted`, so the whole
 * run/cancel/ready loop is driven from the test with no real worker.
 */
class RecordingScope implements WorkloadWorkerScope<TestJob> {
  onmessage: ((ev: MessageEvent<WorkloadRequest<TestJob>>) => void) | null =
    null;
  readonly posted: unknown[] = [];

  postMessage(msg: unknown, _transfer?: Transferable[]): void {
    this.posted.push(msg);
  }

  /** Deliver one host → worker message. */
  send(msg: WorkloadRequest<TestJob>): void {
    this.onmessage?.({ data: msg } as MessageEvent<WorkloadRequest<TestJob>>);
  }

  responses(): WorkloadResponse[] {
    return this.posted.filter(isWorkloadResponse);
  }

  types(): string[] {
    return this.responses().map((msg) => msg.type);
  }

  doneIds(): number[] {
    const ids: number[] = [];
    for (const msg of this.responses()) {
      if (msg.type === "done") ids.push(msg.id);
    }
    return ids;
  }

  progressPayloads(): unknown[] {
    const out: unknown[] = [];
    for (const msg of this.responses()) {
      if (msg.type === "progress") out.push(msg.progress);
    }
    return out;
  }
}

describe("installWorkloadHandler", () => {
  it("installs the loop, posts ready, and runs one job to done", async () => {
    const scope = new RecordingScope();
    installWorkloadHandler<TestJob, TestResult>(
      {
        // No heartbeat: these cases assert message order, not stall padding.
        heartbeatMs: 0,
        async run(job, ctx) {
          ctx.reportProgress({ phase: "work", n: job.n });
          return { result: { id: ctx.id } };
        },
      },
      scope,
    );

    // `ready` is the boot handshake and lands before any job.
    expect(scope.posted[0]).toEqual({ type: "ready" });
    expect(scope.posted.length).toBe(1);

    scope.send({ type: "run", id: 1, job: { n: 21 } });
    await flush();

    expect(scope.types()).toEqual(["ready", "progress", "done"]);
    expect(scope.progressPayloads()).toEqual([{ phase: "work", n: 21 }]);
    expect(scope.doneIds()).toEqual([1]);
  });

  it("queues a second job until the first completes", async () => {
    const started: number[] = [];
    const gates = new Map<number, Deferred>();
    const scope = new RecordingScope();

    installWorkloadHandler<TestJob, TestResult>(
      {
        heartbeatMs: 0,
        async run(_job, ctx) {
          started.push(ctx.id);
          const gate = deferred();
          gates.set(ctx.id, gate);
          await gate.promise;
          return { result: { id: ctx.id } };
        },
      },
      scope,
    );

    scope.send({ type: "run", id: 1, job: { n: 1 } });
    scope.send({ type: "run", id: 2, job: { n: 2 } });
    await flush();

    // ac-005: one heavy molrs job in flight at a time. Job 2 must not have
    // touched WASM while job 1 is still running.
    expect(started).toEqual([1]);

    gates.get(1)?.resolve();
    await flush();
    expect(started).toEqual([1, 2]);

    gates.get(2)?.resolve();
    await flush();
    // Results come back in submission order.
    expect(scope.doneIds()).toEqual([1, 2]);
  });

  it("delivers a cancel that arrives before a queued job starts", async () => {
    const cancelledAtStart = new Map<number, boolean>();
    const gate1 = deferred();
    const scope = new RecordingScope();

    installWorkloadHandler<TestJob, TestResult>(
      {
        heartbeatMs: 0,
        async run(_job, ctx) {
          cancelledAtStart.set(ctx.id, ctx.isCancelled());
          if (ctx.id === 1) await gate1.promise;
          return { result: { id: ctx.id } };
        },
      },
      scope,
    );

    scope.send({ type: "run", id: 1, job: { n: 1 } });
    scope.send({ type: "run", id: 2, job: { n: 2 } });
    scope.send({ type: "cancel", id: 2 });
    gate1.resolve();
    await flush();

    expect(cancelledAtStart.get(1)).toBe(false);
    // A cancel for a job that has not started yet must survive until it does,
    // so the body sees the flag on its first poll instead of doing the work.
    expect(cancelledAtStart.get(2)).toBe(true);
  });
});
