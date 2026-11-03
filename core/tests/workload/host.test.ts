import { describe, expect, it } from "@rstest/core";
import {
  createWorkloadSingleton,
  isWorkloadResponse,
  WorkloadHost,
  type WorkloadRequest,
  type WorkloadResponse,
} from "../../src/workload";

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
      fake.onerror?.({ message: "script load failed" } as ErrorEvent);
    });
    await expect(ready).rejects.toThrow(/script load failed/);
    host.dispose();
  });
});

/**
 * Records every postMessage (message + transfer list) and lets the test emit
 * worker → host messages by hand — including the `host-call` variant that the
 * auto-replying {@link FakeWorker} above does not know about.
 */
class ManualFakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  readonly posted: Array<{
    msg: unknown;
    transfer: Transferable[] | undefined;
  }> = [];
  private terminated = false;

  postMessage(msg: unknown, transfer?: Transferable[]): void {
    if (this.terminated) return;
    this.posted.push({ msg, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(msg: unknown): void {
    this.onmessage?.({ data: msg } as MessageEvent);
  }

  /** Signal ready after the host attaches listeners. */
  signalReady(): void {
    queueMicrotask(() => {
      this.emit({ type: "ready" });
    });
  }

  postedOfType(type: string): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const { msg } of this.posted) {
      if (
        msg !== null &&
        typeof msg === "object" &&
        (msg as { type?: unknown }).type === type
      ) {
        out.push(msg as Record<string, unknown>);
      }
    }
    return out;
  }

  /** Transfer list passed with the first posted message of `type`. */
  transferOf(type: string): Transferable[] | undefined {
    for (const { msg, transfer } of this.posted) {
      if (
        msg !== null &&
        typeof msg === "object" &&
        (msg as { type?: unknown }).type === type
      ) {
        return transfer;
      }
    }
    return undefined;
  }
}

/** Drain the microtask queue so async host internals settle. */
async function flush(turns = 16): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

describe("WorkloadHost.submit", () => {
  it("returns a ticket whose result and completion settle with the done value", async () => {
    const fake = new ManualFakeWorker();
    const host = new WorkloadHost<{ n: number }, { doubled: number }>({
      name: "submit-work",
      createWorker: () => {
        fake.signalReady();
        return fake as unknown as Worker;
      },
    });

    const ticket = host.submit({ n: 21 });
    expect(typeof ticket.id).toBe("number");
    await flush();

    expect(fake.postedOfType("run")).toEqual([
      { type: "run", id: ticket.id, job: { n: 21 } },
    ]);

    fake.emit({ type: "done", id: ticket.id, result: { doubled: 42 } });
    // Without earlyResolve both promises settle together, with the done value.
    await expect(ticket.result).resolves.toEqual({ doubled: 42 });
    await expect(ticket.completion).resolves.toEqual({ doubled: 42 });
    host.dispose();
  });

  it("assigns incrementing ids to consecutive submits", async () => {
    const fake = new ManualFakeWorker();
    const host = new WorkloadHost<{ n: number }, { doubled: number }>({
      name: "submit-ids",
      createWorker: () => {
        fake.signalReady();
        return fake as unknown as Worker;
      },
    });

    const first = host.submit({ n: 1 });
    const second = host.submit({ n: 2 });
    expect(second.id).toBe(first.id + 1);

    await flush();
    fake.emit({ type: "done", id: first.id, result: { doubled: 2 } });
    fake.emit({ type: "done", id: second.id, result: { doubled: 4 } });
    await expect(first.result).resolves.toEqual({ doubled: 2 });
    await expect(second.result).resolves.toEqual({ doubled: 4 });
    host.dispose();
  });

  it("earlyResolve settles result on the first matching progress, completion at done", async () => {
    const fake = new ManualFakeWorker();
    const host = new WorkloadHost<
      { n: number },
      { doubled: number },
      { n: number }
    >({
      name: "early-work",
      createWorker: () => {
        fake.signalReady();
        return fake as unknown as Worker;
      },
    });

    const ticket = host.submit(
      { n: 1 },
      {
        earlyResolve: (progress: { n: number }) =>
          progress.n >= 1 ? { doubled: -1 } : undefined,
      },
    );
    let resultValue: { doubled: number } | null = null;
    let completionValue: { doubled: number } | null = null;
    ticket.result.then((v: { doubled: number }) => {
      resultValue = v;
    });
    ticket.completion.then((v: { doubled: number }) => {
      completionValue = v;
    });
    await flush();

    fake.emit({ type: "progress", id: ticket.id, progress: { n: 0 } });
    await flush();
    // Progress below the threshold: earlyResolve returned undefined.
    expect(resultValue).toBeNull();

    fake.emit({ type: "progress", id: ticket.id, progress: { n: 1 } });
    await flush();
    expect(resultValue).toEqual({ doubled: -1 });
    // completion always waits for the terminal message.
    expect(completionValue).toBeNull();

    fake.emit({ type: "done", id: ticket.id, result: { doubled: 2 } });
    await flush();
    expect(completionValue).toEqual({ doubled: 2 });
    host.dispose();
  });
});

describe("WorkloadHost cancelMode", () => {
  it('"reject" rejects result and completion with WorkloadCancelledError', async () => {
    const fake = new ManualFakeWorker();
    const host = new WorkloadHost<{ n: number }, { doubled: number }>({
      name: "reject-cancel",
      createWorker: () => {
        fake.signalReady();
        return fake as unknown as Worker;
      },
    });

    const ticket = host.submit({ n: 1 }, { cancelMode: "reject" });
    await flush();
    host.cancel(ticket.id);

    const resultErr = await ticket.result.then(
      () => null,
      (e: unknown) => e as Error & { jobId?: number },
    );
    const completionErr = await ticket.completion.then(
      () => null,
      (e: unknown) => e as Error & { jobId?: number },
    );
    expect(resultErr?.name).toBe("WorkloadCancelledError");
    expect(resultErr?.jobId).toBe(ticket.id);
    expect(completionErr?.name).toBe("WorkloadCancelledError");
    // The cancel still goes to the worker so it stops wasting cycles.
    expect(fake.postedOfType("cancel")).toEqual([
      { type: "cancel", id: ticket.id },
    ]);
    host.dispose();
  });

  it('a late done after a "reject" cancel is dropped', async () => {
    const fake = new ManualFakeWorker();
    const host = new WorkloadHost<{ n: number }, { doubled: number }>({
      name: "late-done",
      createWorker: () => {
        fake.signalReady();
        return fake as unknown as Worker;
      },
    });

    const ticket = host.submit({ n: 1 }, { cancelMode: "reject" });
    await flush();
    host.cancel(ticket.id);
    const firstOutcome = await ticket.result.then(
      () => "resolved",
      () => "rejected",
    );
    expect(firstOutcome).toBe("rejected");

    // Worker answers done anyway — the settled promises must not flip and
    // the stray message must not throw or leak an unhandled rejection.
    fake.emit({ type: "done", id: ticket.id, result: { doubled: 99 } });
    await flush();
    const stillRejected = await ticket.completion.then(
      () => "resolved",
      () => "rejected",
    );
    expect(stillRejected).toBe("rejected");
    host.dispose();
  });

  it("default cancelMode still settles through the worker's own done", async () => {
    const fake = new ManualFakeWorker();
    const host = new WorkloadHost<{ n: number }, { doubled: number }>({
      name: "partial-cancel",
      createWorker: () => {
        fake.signalReady();
        return fake as unknown as Worker;
      },
    });

    const ticket = host.submit({ n: 7 });
    await flush();
    host.cancel(ticket.id);
    // resolve-partial: the promise waits for the worker's own (partial) done.
    fake.emit({ type: "done", id: ticket.id, result: { doubled: 0 } });
    await expect(ticket.result).resolves.toEqual({ doubled: 0 });
    await expect(ticket.completion).resolves.toEqual({ doubled: 0 });
    host.dispose();
  });
});

describe("WorkloadHost readyTimeoutMs", () => {
  it("rejects whenReady when the worker never signals ready in time", async () => {
    const fake = new ManualFakeWorker(); // never signals ready
    const host = new WorkloadHost({
      name: "ready-timeout",
      createWorker: () => fake as unknown as Worker,
      readyTimeoutMs: 50,
    });

    const outcome = await Promise.race([
      host.whenReady().then(
        () => "resolved",
        (e: Error) => `rejected: ${e.message}`,
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("still pending"), 500);
      }),
    ]);
    expect(outcome).toMatch(/^rejected: \[ready-timeout\]/);
    expect(outcome).toMatch(/within|timeout/i);
    expect(outcome).toContain("50");
    expect(host.isDead).toBe(true);
    host.dispose();
  }, 20_000);

  it("without the option, whenReady never times out on its own", async () => {
    const fake = new ManualFakeWorker(); // never signals ready
    const host = new WorkloadHost({
      name: "no-timeout",
      createWorker: () => fake as unknown as Worker,
    });

    const outcome = await Promise.race([
      host.whenReady().then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("still pending"), 150);
      }),
    ]);
    expect(outcome).toBe("still pending");
    host.dispose();
  }, 20_000);
});

describe("WorkloadHost onHostCall", () => {
  it("answers a host-call with an ok reply and forwards the transfer list", async () => {
    const fake = new ManualFakeWorker();
    const received: unknown[] = [];
    const buf = new ArrayBuffer(4);
    const host = new WorkloadHost<{ n: number }, { doubled: number }>({
      name: "hostcall-work",
      createWorker: () => {
        fake.signalReady();
        return fake as unknown as Worker;
      },
      onHostCall: async (call: unknown) => {
        received.push(call);
        return { result: buf, transfer: [buf] };
      },
    });

    await host.whenReady();
    fake.emit({
      type: "host-call",
      callId: 7,
      call: { byteOffset: 0, byteLen: 4 },
    });
    await flush();

    expect(received).toEqual([{ byteOffset: 0, byteLen: 4 }]);
    expect(fake.postedOfType("host-reply")).toEqual([
      { type: "host-reply", callId: 7, ok: true, result: buf },
    ]);
    expect(fake.transferOf("host-reply")).toEqual([buf]);
    host.dispose();
  });

  it("replies ok: false with a [name]-prefixed error when onHostCall is missing", async () => {
    const fake = new ManualFakeWorker();
    const host = new WorkloadHost<{ n: number }, { doubled: number }>({
      name: "no-hostcall",
      createWorker: () => {
        fake.signalReady();
        return fake as unknown as Worker;
      },
    });

    await host.whenReady();
    fake.emit({ type: "host-call", callId: 8, call: {} });
    await flush();

    const replies = fake.postedOfType("host-reply");
    expect(replies.length).toBe(1);
    const reply = replies[0];
    if (!reply) throw new Error("host-reply was not posted");
    expect(reply.callId).toBe(8);
    expect(reply.ok).toBe(false);
    expect(String(reply.error)).toMatch(/^\[no-hostcall\]/);
    host.dispose();
  });
});
