/**
 * Unit tests for `src/worker_spawner.ts` — `DeferredWorker` only
 * (spec worker-arch-unify-03-spawn, ac-003).
 *
 * The two spawn functions (`spawnTrajectoryWorker`, `spawnComputeWorker`)
 * construct real Workers from literal `new Worker(new URL(...))`
 * expressions; per the long-standing "Tests should NOT call this"
 * convention they are not unit-called here.
 *
 * `DeferredWorker` bridges an async spawn (`Promise<Worker>`) into the
 * synchronous property-style Worker face that core's
 * `WorkloadHostOptions.createWorker: () => Worker` factory demands:
 * `postMessage` buffers until the inner worker resolves and then flushes
 * in order; `onmessage`/`onerror` handlers assigned before readiness
 * receive inner events after readiness; `terminate()` before resolution
 * terminates the late-arriving inner immediately and flushes nothing;
 * a rejected spawn promise synthesizes an error event to `onerror`.
 */

import { describe, expect, it } from "@rstest/core";
import { DeferredWorker } from "../src/worker_spawner";

/**
 * Property-style fake inner worker: records postMessage / terminate and
 * lets the test emit worker → host events by hand (same style as
 * core/tests/workload_host.test.ts ManualFakeWorker).
 */
class FakeInnerWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  terminateCalls = 0;

  postMessage(msg: unknown, _transfer?: Transferable[]): void {
    this.posted.push(msg);
  }

  terminate(): void {
    this.terminateCalls++;
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError(ev: ErrorEvent): void {
    this.onerror?.(ev);
  }
}

/** Manually-settled Promise<Worker> so tests control the resolve tick. */
function deferredSpawn(): {
  promise: Promise<Worker>;
  resolve: (w: FakeInnerWorker) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (w: FakeInnerWorker) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Worker>((res, rej) => {
    resolve = (w: FakeInnerWorker) => res(w as unknown as Worker);
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drain the microtask queue so the deferred bridge settles. */
async function flush(turns = 16): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

describe("DeferredWorker", () => {
  it("buffers postMessage until the inner resolves, then flushes in order", async () => {
    const spawn = deferredSpawn();
    const inner = new FakeInnerWorker();
    const dw = new DeferredWorker(spawn.promise);

    dw.postMessage("a");
    dw.postMessage("b");
    dw.postMessage("c");
    expect(inner.posted).toEqual([]);

    spawn.resolve(inner);
    await flush();

    expect(inner.posted).toEqual(["a", "b", "c"]);
  });

  it("forwards inner messages to an onmessage handler assigned before readiness", async () => {
    const spawn = deferredSpawn();
    const inner = new FakeInnerWorker();
    const dw = new DeferredWorker(spawn.promise);

    const received: unknown[] = [];
    dw.onmessage = (ev: MessageEvent) => {
      received.push(ev.data);
    };

    spawn.resolve(inner);
    await flush();
    inner.emitMessage({ type: "ready" });

    expect(received).toEqual([{ type: "ready" }]);
  });

  it("forwards inner errors to an onerror handler assigned before readiness", async () => {
    const spawn = deferredSpawn();
    const inner = new FakeInnerWorker();
    const dw = new DeferredWorker(spawn.promise);

    const received: string[] = [];
    dw.onerror = (ev: ErrorEvent) => {
      received.push(ev.message);
    };

    spawn.resolve(inner);
    await flush();
    inner.emitError({ message: "inner blew up" } as ErrorEvent);

    expect(received).toEqual(["inner blew up"]);
  });

  it("terminate before resolution terminates the late inner and flushes nothing", async () => {
    const spawn = deferredSpawn();
    const inner = new FakeInnerWorker();
    const dw = new DeferredWorker(spawn.promise);

    dw.postMessage("a");
    dw.terminate();
    spawn.resolve(inner);
    await flush();

    expect(inner.terminateCalls).toBe(1);
    expect(inner.posted).toEqual([]);
  });
});
