import { describe, expect, it } from "@rstest/core";
import {
  createWorkloadSingleton,
  isWorkloadResponse,
  WorkloadHost,
  type WorkloadRequest,
  type WorkloadResponse,
} from "../src/workload";

/**
 * Minimal in-process fake: implements the worker protocol on the main
 * thread so tests do not need a real DedicatedWorker + WASM.
 */
class FakeWorker extends EventTarget {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  /** Job ids the host asked to cancel, in arrival order. */
  readonly cancelledIds: number[] = [];
  private readonly openJobs = new Set<number>();
  /** A terminated DedicatedWorker never answers again. */
  private terminated = false;

  /**
   * @param keepOpen emit progress only and leave the job running until the
   *   host posts `{ type: "cancel" }` (mid-run cancel scenario).
   * @param cancelDelayMs how long the worker takes to wind the job down after
   *   the first cancel (0 = next microtask). A slow wind-down is what exposes
   *   a cancel poll that keeps firing.
   */
  constructor(
    private readonly keepOpen = false,
    private readonly cancelDelayMs = 0,
  ) {
    super();
  }

  postMessage(data: WorkloadRequest<{ n: number }>): void {
    if (this.terminated) return;
    if (data.type === "cancel") {
      this.cancelledIds.push(data.id);
      if (!this.openJobs.delete(data.id)) return;
      const finish = () => {
        this.emit({
          type: "done",
          id: data.id,
          result: { doubled: 0, cancelled: true },
        });
      };
      if (this.cancelDelayMs > 0) {
        setTimeout(finish, this.cancelDelayMs);
      } else {
        queueMicrotask(finish);
      }
      return;
    }
    if (data.type !== "run") return;
    const id = data.id;
    const n = data.job.n;
    this.openJobs.add(id);
    queueMicrotask(() => {
      this.emit({
        type: "progress",
        id,
        progress: { phase: "work", n },
      });
      if (this.keepOpen) return;
      this.openJobs.delete(id);
      this.emit({
        type: "done",
        id,
        result: { doubled: n * 2 },
      });
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(msg: WorkloadResponse): void {
    const ev = { data: msg } as MessageEvent;
    this.onmessage?.(ev);
  }

  /** Signal ready after the host attaches listeners. */
  signalReady(): void {
    queueMicrotask(() => {
      this.emit({ type: "ready" });
    });
  }

  /** Signal ready synchronously (caller controls the exact tick). */
  signalReadyNow(): void {
    this.emit({ type: "ready" });
  }
}

describe("WorkloadHost", () => {
  it("isWorkloadResponse discriminates envelopes", () => {
    expect(isWorkloadResponse({ type: "ready" })).toBe(true);
    expect(isWorkloadResponse({ type: "done", id: 1, result: null })).toBe(
      true,
    );
    expect(isWorkloadResponse({ type: "nope" })).toBe(false);
    expect(isWorkloadResponse(null)).toBe(false);
  });

  it("runs a job with progress and done", async () => {
    const fake = new FakeWorker();
    const host = new WorkloadHost<
      { n: number },
      { doubled: number },
      { phase: string; n: number }
    >({
      name: "test-work",
      createWorker: () => {
        fake.signalReady();
        return fake as unknown as Worker;
      },
    });

    const progress: Array<{ phase: string; n: number }> = [];
    const result = await host.run(
      { n: 21 },
      {
        onProgress: (p) => progress.push(p),
      },
    );

    expect(result.doubled).toBe(42);
    expect(progress).toEqual([{ phase: "work", n: 21 }]);
    host.dispose();
  });

  it("cancels a mid-run job and resolves with the cancelled result", async () => {
    const fake = new FakeWorker(true);
    const host = new WorkloadHost<
      { n: number },
      { doubled: number; cancelled: boolean },
      { phase: string; n: number }
    >({
      name: "cancel-work",
      createWorker: () => {
        fake.signalReady();
        return fake as unknown as Worker;
      },
    });

    let progressSeen = 0;
    const result = await host.run(
      { n: 7 },
      {
        onProgress: () => {
          progressSeen++;
        },
        shouldCancel: () => progressSeen >= 1,
        cancelPollMs: 5,
      },
    );

    expect(progressSeen).toBe(1);
    expect(result).toEqual({ doubled: 0, cancelled: true });
    expect(fake.cancelledIds).toEqual([1]);
    host.dispose();
  });

  it("posts exactly one cancel while the worker winds down", async () => {
    // Worker takes 50 ms to answer the cancel; the poll runs every 5 ms.
    const fake = new FakeWorker(true, 50);
    const host = new WorkloadHost<
      { n: number },
      { doubled: number; cancelled: boolean },
      { phase: string; n: number }
    >({
      name: "cancel-once",
      createWorker: () => {
        fake.signalReady();
        return fake as unknown as Worker;
      },
      cancelPollMs: 5,
    });

    const result = await host.run(
      { n: 7 },
      // Permanently cancelled: the poll must still speak only once.
      { shouldCancel: () => true },
    );

    expect(result).toEqual({ doubled: 0, cancelled: true });
    expect(fake.cancelledIds).toEqual([1]);
    host.dispose();
  }, 20_000);

  it("rejects a run that resumes after dispose", async () => {
    const fake = new FakeWorker();
    const host = new WorkloadHost<{ n: number }, { doubled: number }>({
      name: "disposed",
      createWorker: () => fake as unknown as Worker,
    });

    // run() parks on whenReady; ready then resolves, so its continuation is
    // queued behind this tick — dispose lands first. (Disposing *before*
    // ready resolves already rejects through the ready promise.)
    const run = host.run({ n: 5 });
    fake.signalReadyNow();
    host.dispose();

    const settled = run.then(
      () => "resolved",
      () => "rejected",
    );
    const timer = new Promise<string>((resolve) => {
      setTimeout(() => resolve("still pending"), 100);
    });
    await expect(Promise.race([settled, timer])).resolves.toBe("rejected");
  }, 20_000);

  it("createWorkloadSingleton reuses until disposed", () => {
    let builds = 0;
    const api = createWorkloadSingleton(() => {
      builds++;
      const fake = new FakeWorker();
      fake.signalReady();
      return new WorkloadHost({
        name: "singleton",
        createWorker: () => fake as unknown as Worker,
      });
    });
    const a = api.get();
    const b = api.get();
    expect(a).toBe(b);
    expect(builds).toBe(1);
    a.dispose();
    const c = api.get();
    expect(c).not.toBe(a);
    expect(builds).toBe(2);
    c.dispose();
  });

  it("whenReady rejects when the worker errors before ready", async () => {
    const fake = new FakeWorker();
    const host = new WorkloadHost({
      name: "boom",
      createWorker: () => fake as unknown as Worker,
    });
    const ready = host.whenReady();
    queueMicrotask(() => {
      fake.onerror?.(
        new ErrorEvent("error", { message: "script load failed" }),
      );
    });
    await expect(ready).rejects.toThrow(/script load failed/);
    host.dispose();
  });
});
