/**
 * Unit tests for the rebuilt `TrajectoryRuntime` (spec
 * worker-arch-unify-02-runtime): the runtime is expected to speak the core
 * workload envelope — `{ type: "run" | "cancel" | "host-reply" }` outbound,
 * `{ type: "ready" | "progress" | "done" | "error" | "host-call" }` inbound —
 * instead of the old hand-rolled wire protocol.
 *
 * The public `WorkerLike` shape (addEventListener-style) is frozen, so the
 * fake worker implements exactly that surface. The envelope and job types
 * are declared locally, mirroring the spec's binding wire contract, so this
 * file compiles against today's frozen public symbols and every failure
 * lands on a behavioral assertion, not on an import error.
 */

import { describe, expect, it, rstest } from "@rstest/core";
import { BlobRangeSource } from "../../../src/io/sources";
import type { TrajectorySource } from "../../../src/io/sources/trajectory_source";
import {
  CancellationError,
  type Format,
  type FrameMessage,
  type OpenResult,
  SECTION_UPDATE_LOG_CAPACITY,
  type SourceHandle,
  TrajectoryRuntime,
  type WorkerLike,
} from "../../../src/transport/trajectory_worker";

// ---------------------------------------------------------------------------
//  Binding wire contract (spec worker-arch-unify-02-runtime, Design section).
//  Local declarations: protocol.ts exports these shapes, but the tests bind
//  the wire, not the export site.
// ---------------------------------------------------------------------------

type TrajectoryJobWire =
  | {
      kind: "open";
      source: SourceHandle;
      format: Format;
      chunkSize?: number;
      fingerprint?: string;
    }
  | { kind: "load-frame"; frameId: number }
  | { kind: "close" };

type TrajectoryJobResultWire =
  | {
      kind: "open-result";
      frameCount: number;
      totalBytes: number;
      indexComplete: boolean;
    }
  | FrameMessage
  | { kind: "closed" };

interface TrajectoryIndexProgressWire {
  bytesScanned: number;
  totalBytes: number;
  framesIndexedSoFar: number;
}

type RunMessage = { type: "run"; id: number; job: TrajectoryJobWire };
type CancelMessage = { type: "cancel"; id: number };
type HostReplyMessage = {
  type: "host-reply";
  callId: number;
  ok: boolean;
  result?: ArrayBuffer;
  error?: string;
};
type HostToWorker = RunMessage | CancelMessage | HostReplyMessage;

type WorkerToHost =
  | { type: "ready" }
  | { type: "progress"; id: number; progress: TrajectoryIndexProgressWire }
  | { type: "done"; id: number; result: TrajectoryJobResultWire }
  | { type: "error"; id: number; message: string }
  | {
      type: "host-call";
      callId: number;
      call: { byteOffset: number; byteLen: number };
    };

// ---------------------------------------------------------------------------
//  Fake worker (frozen public WorkerLike surface, workload envelope inside)
// ---------------------------------------------------------------------------

/**
 * Fake `Worker` speaking the workload envelope over the frozen
 * addEventListener-style `WorkerLike` surface. Emits `{ type: "ready" }`
 * once a "message" listener registers (mirrors the real worker's boot
 * handshake), records every outbound post + transfer list, and runs the
 * per-test `script` for each `{ type: "run" }` envelope.
 */
class FakeWorkloadWorker implements WorkerLike {
  private readonly listeners = new Map<string, Array<(e: Event) => void>>();
  readonly posts: Array<{
    msg: unknown;
    transfer: Transferable[] | undefined;
  }> = [];
  terminated = false;
  private readySent = false;

  constructor(
    private readonly script: (
      run: RunMessage,
      fake: FakeWorkloadWorker,
    ) => void = () => {},
    private readonly autoReady = true,
  ) {}

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.posts.push({ msg: message, transfer });
    const tagged = message as { type?: unknown };
    if (
      tagged !== null &&
      typeof tagged === "object" &&
      tagged.type === "run"
    ) {
      // Microtask so the runtime finishes registering its pending state
      // before the scripted response lands, like a real worker turn.
      queueMicrotask(() => this.script(message as RunMessage, this));
    }
  }

  addEventListener(type: string, listener: (e: Event) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
    if (type === "message" && this.autoReady && !this.readySent) {
      this.readySent = true;
      queueMicrotask(() => this.emit({ type: "ready" }));
    }
  }

  removeEventListener(type: string, listener: (e: Event) => void): void {
    const arr = this.listeners.get(type);
    if (arr) {
      this.listeners.set(
        type,
        arr.filter((l) => l !== listener),
      );
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Dispatch a worker → main envelope to all "message" listeners. */
  emit(msg: WorkerToHost): void {
    const event = { data: msg } as MessageEvent;
    for (const l of [...(this.listeners.get("message") ?? [])]) {
      l(event as unknown as Event);
    }
  }

  /** Fire the worker "error" event (boot failure path). */
  emitError(message: string): void {
    const event = { type: "error", message } as ErrorEvent;
    for (const l of [...(this.listeners.get("error") ?? [])]) l(event);
  }

  /** All outbound envelopes of one `type`, in post order. */
  ofType<T extends HostToWorker["type"]>(
    type: T,
  ): Array<Extract<HostToWorker, { type: T }>> {
    const out: Array<Extract<HostToWorker, { type: T }>> = [];
    for (const { msg } of this.posts) {
      if (
        msg !== null &&
        typeof msg === "object" &&
        (msg as { type?: unknown }).type === type
      ) {
        out.push(msg as Extract<HostToWorker, { type: T }>);
      }
    }
    return out;
  }

  /** Transfer list of the first outbound envelope of `type`. */
  transferOf(type: HostToWorker["type"]): Transferable[] | undefined {
    for (const { msg, transfer } of this.posts) {
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

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function blobSource(content: string): BlobRangeSource {
  return new BlobRangeSource(new Blob([content]));
}

/** Drain the microtask queue so async runtime internals settle. */
async function flush(turns = 64): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

/**
 * Wait (microtask turns only — the whole fake pipeline is microtask-driven)
 * until `cond` holds, or fail fast with a diagnosable message. This is what
 * turns "the runtime still speaks the old wire protocol" into an immediate
 * assertion failure instead of a test timeout.
 */
async function waitFor(
  cond: () => boolean,
  what: string,
  turns = 512,
): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (cond()) return;
    await Promise.resolve();
  }
  throw new Error(
    `timed out waiting for ${what} (workload envelope never seen)`,
  );
}

/** Minimal frame payload the runtime must pass through `rehydrateFrame`. */
function frameMessage(frameId: number): FrameMessage {
  return {
    kind: "frame",
    frameId,
    blocks: [
      {
        name: "atoms",
        columns: [
          { name: "x", dtype: "f64", data: new Float64Array([1, 2, 3]) },
          { name: "y", dtype: "f64", data: new Float64Array([4, 5, 6]) },
          { name: "z", dtype: "f64", data: new Float64Array([7, 8, 9]) },
          { name: "element", dtype: "string", data: ["C", "O", "H"] },
        ],
      },
    ],
    box: null,
  };
}

// ---------------------------------------------------------------------------
//  Tests
// ---------------------------------------------------------------------------

describe("TrajectoryRuntime (workload channel)", () => {
  it("posts a {type:'run'} open job and early-resolves on the first framesIndexedSoFar >= 1 progress", async () => {
    const worker = new FakeWorkloadWorker((run, fake) => {
      if (run.job.kind !== "open") return;
      fake.emit({
        type: "progress",
        id: run.id,
        progress: {
          bytesScanned: 512,
          totalBytes: 1024,
          framesIndexedSoFar: 2,
        },
      });
    });
    const runtime = new TrajectoryRuntime(worker, "xyz");

    const opening = runtime.open(blobSource("..."));
    await waitFor(
      () => worker.ofType("run").length === 1,
      "the open {type:'run'} envelope",
    );
    const run = worker.ofType("run")[0];
    expect(run?.job).toEqual({
      kind: "open",
      source: { kind: "blob", totalBytes: 3 },
      format: "xyz",
    });

    const result = await opening;
    // Binding golden (spec Testing strategy, hard-coded literal).
    expect(result).toEqual({
      frameCount: 2,
      indexedLength: 2,
      length: null,
      indexComplete: false,
      totalBytes: 1024,
    } satisfies OpenResult);
    await runtime.close();
  });

  it("feeds whenIndexComplete and onIndexComplete the indexComplete:true terminal result after the done open-result", async () => {
    const worker = new FakeWorkloadWorker((run, fake) => {
      if (run.job.kind !== "open") return;
      fake.emit({
        type: "progress",
        id: run.id,
        progress: {
          bytesScanned: 512,
          totalBytes: 1024,
          framesIndexedSoFar: 2,
        },
      });
      queueMicrotask(() => {
        fake.emit({
          type: "done",
          id: run.id,
          result: {
            kind: "open-result",
            frameCount: 2,
            totalBytes: 1024,
            indexComplete: true,
          },
        });
      });
    });
    const runtime = new TrajectoryRuntime(worker, "xyz");

    const terminalViaCallback: OpenResult[] = [];
    const opening = runtime.open(blobSource("..."), {
      onIndexComplete: (r) => terminalViaCallback.push(r),
    });
    await waitFor(
      () => worker.ofType("run").length === 1,
      "the open {type:'run'} envelope",
    );

    const early = await opening;
    expect(early.indexComplete).toBe(false);

    const goldenTerminal: OpenResult = {
      frameCount: 2,
      indexedLength: 2,
      length: 2,
      indexComplete: true,
      totalBytes: 1024,
    };
    const terminal = await runtime.whenIndexComplete;
    expect(terminal).toEqual(goldenTerminal);
    await waitFor(
      () => terminalViaCallback.length === 1,
      "the onIndexComplete callback",
    );
    expect(terminalViaCallback[0]).toEqual(goldenTerminal);
    await runtime.close();
  });

  it("rehydrates a molrs Frame from a load-frame done payload", async () => {
    const worker = new FakeWorkloadWorker((run, fake) => {
      if (run.job.kind !== "load-frame") return;
      fake.emit({
        type: "done",
        id: run.id,
        result: frameMessage(run.job.frameId),
      });
    });
    const runtime = new TrajectoryRuntime(worker, "xyz");

    const loading = runtime.loadFrame(0);
    await waitFor(
      () => worker.ofType("run").length === 1,
      "the load-frame {type:'run'} envelope",
    );
    const run = worker.ofType("run")[0];
    expect(run?.job).toEqual({ kind: "load-frame", frameId: 0 });

    const frame = await loading;
    const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
    expect(atoms?.nRows).toBe(3);
    expect(Array.from((atoms?.copy("x") as Float64Array) ?? [])).toEqual([
      1, 2, 3,
    ]);
    await runtime.close();
  });

  it("forwards open options (chunkSize, fingerprint) into the run job payload", async () => {
    const worker = new FakeWorkloadWorker((run, fake) => {
      if (run.job.kind !== "open") return;
      fake.emit({
        type: "done",
        id: run.id,
        result: {
          kind: "open-result",
          frameCount: 1,
          totalBytes: 4,
          indexComplete: true,
        },
      });
    });
    const runtime = new TrajectoryRuntime(worker, "xyz");

    const opening = runtime.open(blobSource("abcd"), {
      chunkSize: 1024,
      fingerprint: "fp-abc",
    });
    await waitFor(
      () => worker.ofType("run").length === 1,
      "the open {type:'run'} envelope",
    );
    const job = worker.ofType("run")[0]?.job;
    if (job?.kind !== "open") throw new Error("expected an open job payload");
    expect(job.chunkSize).toBe(1024);
    expect(job.fingerprint).toBe("fp-abc");
    await opening;
    await runtime.close();
  });

  it("cancelOpen posts {type:'cancel'} and rejects the in-flight open with CancellationError", async () => {
    // Silent script: the open job stays pending so cancel can win.
    const worker = new FakeWorkloadWorker();
    const runtime = new TrajectoryRuntime(worker, "xyz");

    const opening = runtime.open(blobSource("..."));
    const outcome = opening.then(
      () => null,
      (e: unknown) => e as Error,
    );
    await waitFor(
      () => worker.ofType("run").length === 1,
      "the open {type:'run'} envelope",
    );

    runtime.cancelOpen();
    const err = await outcome;
    expect(err).toBeInstanceOf(CancellationError);
    expect(err?.name).toBe("CancellationError");
    // The channel's own cancel rejection must never escape the runtime
    // boundary (spec: WorkloadCancelledError is translated, not re-exported).
    expect(err?.name).not.toBe("WorkloadCancelledError");
    expect(worker.ofType("cancel").length).toBe(1);
    await runtime.close();
  });

  it("loadFrameLatest latest-wins: first rejects CancellationError, second resolves", async () => {
    const worker = new FakeWorkloadWorker((run, fake) => {
      // Only the surviving (latest) frame is ever answered.
      if (run.job.kind !== "load-frame" || run.job.frameId !== 1) return;
      fake.emit({
        type: "done",
        id: run.id,
        result: frameMessage(1),
      });
    });
    const runtime = new TrajectoryRuntime(worker, "xyz");

    const first = runtime.loadFrameLatest(0);
    const firstOutcome = first.then(
      () => null,
      (e: unknown) => e as Error,
    );
    const second = runtime.loadFrameLatest(1);

    const firstErr = await firstOutcome;
    expect(firstErr).toBeInstanceOf(CancellationError);
    expect(firstErr?.name).toBe("CancellationError");
    expect(firstErr?.name).not.toBe("WorkloadCancelledError");

    await waitFor(
      () => worker.ofType("run").length === 2,
      "both load-frame {type:'run'} envelopes",
    );
    expect(worker.ofType("cancel").length).toBe(1);

    const frame = await second;
    expect(frame.get("atoms").nRows).toBe(3);
    await runtime.close();
  });

  it("answers a worker host-call by packing readRange bytes before transfer (pooled-view case)", async () => {
    // Pooled backing buffer: readRange hands back a *view* at offset 3 —
    // the VS Code IPC pooled-buffer trap. Golden bytes [1, 2, 3, 4].
    const backing = new Uint8Array([9, 9, 9, 1, 2, 3, 4, 9]);
    const pooledView = new Uint8Array(backing.buffer, 3, 4);
    const readRangeCalls: Array<[number, number]> = [];
    const source: TrajectorySource = {
      kind: "blob",
      size: () => Promise.resolve(backing.byteLength),
      readRange: (start, end) => {
        readRangeCalls.push([start, end]);
        return Promise.resolve(pooledView);
      },
    };

    const worker = new FakeWorkloadWorker((run, fake) => {
      if (run.job.kind !== "open") return;
      fake.emit({
        type: "progress",
        id: run.id,
        progress: { bytesScanned: 4, totalBytes: 8, framesIndexedSoFar: 1 },
      });
      fake.emit({
        type: "host-call",
        callId: 7,
        call: { byteOffset: 3, byteLen: 4 },
      });
    });
    const runtime = new TrajectoryRuntime(worker, "xyz");

    const opening = runtime.open(source);
    await waitFor(
      () => worker.ofType("host-reply").length === 1,
      "the {type:'host-reply'} envelope",
    );
    await opening;

    // readRange seam unchanged: half-open [start, end) from the call payload.
    expect(readRangeCalls).toEqual([[3, 7]]);

    const reply = worker.ofType("host-reply")[0];
    if (!reply) throw new Error("host-reply was not posted");
    expect(reply.callId).toBe(7);
    expect(reply.ok).toBe(true);
    const result = reply.result;
    if (!(result instanceof ArrayBuffer)) {
      throw new Error("host-reply result must be an ArrayBuffer");
    }
    // Packed copy: exactly the golden bytes, exactly 4 bytes long, and never
    // the pooled backing buffer (transferring that would ship [9,9,9,…] and
    // detach the pool).
    expect(result.byteLength).toBe(4);
    expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3, 4]);
    expect(result).not.toBe(backing.buffer);
    expect(worker.transferOf("host-reply")).toEqual([result]);
    await runtime.close();
  });

  // Behavior-preservation (GREEN before the rebuild): the worker "error"
  // event drives the same failAll path as the ready-timeout expiry, so the
  // observable contract — a pending open() rejects with a trajectory-prefixed
  // boot failure carrying the worker's message — is provable without waiting.
  // The 30s window itself is pinned by the fake-timer case below; the value
  // is fixed at 30_000 inside the runtime and not injectable, so a real-timer
  // expiry test is impossible in a unit suite.
  it("rejects a pending open() when the worker errors before ready", async () => {
    const worker = new FakeWorkloadWorker(() => {}, /* autoReady */ false);
    const runtime = new TrajectoryRuntime(worker, "xyz");

    const outcome = runtime.open(blobSource("...")).then(
      () => null,
      (e: unknown) => e as Error,
    );
    await flush();
    worker.emitError("boom");

    const err = await outcome;
    expect(err).not.toBeNull();
    expect(String(err?.message)).toMatch(/trajectory/i);
    expect(String(err?.message)).toMatch(/boom/);
  });

  // Behavior-preservation (GREEN before the rebuild — the old constructor
  // owns an equivalent 30s timer): fake timers pin the 30_000 ms ready
  // window the spec moves into `readyTimeoutMs`.
  it("rejects open() when the worker never signals ready within 30s (fake timers)", async () => {
    rstest.useFakeTimers();
    try {
      const worker = new FakeWorkloadWorker(() => {}, /* autoReady */ false);
      const runtime = new TrajectoryRuntime(worker, "xyz");

      const outcome = runtime.open(blobSource("...")).then(
        () => null,
        (e: unknown) => e as Error,
      );
      let settled = false;
      void outcome.then(() => {
        settled = true;
      });

      await rstest.advanceTimersByTimeAsync(29_000);
      expect(settled).toBe(false);
      await rstest.advanceTimersByTimeAsync(1_001);
      expect(settled).toBe(true);

      const err = await outcome;
      expect(err).not.toBeNull();
      expect(String(err?.message)).toMatch(/trajectory/i);
    } finally {
      rstest.useRealTimers();
    }
  });

  // Behavior-preservation (GREEN before the rebuild): close semantics are
  // part of the frozen public surface — terminate the worker, reject
  // in-flight loads, reject later loads without re-posting.
  it("close() terminates the worker and rejects in-flight and later loads", async () => {
    // Silent script: the in-flight load never gets an answer.
    const worker = new FakeWorkloadWorker();
    const runtime = new TrajectoryRuntime(worker, "lammps-dump");

    const inflight = runtime.loadFrame(0).then(
      () => null,
      (e: unknown) => e as Error,
    );
    await flush();
    await runtime.close();
    expect(worker.terminated).toBe(true);

    const inflightErr = await inflight;
    expect(inflightErr).not.toBeNull();
    expect(String(inflightErr?.message)).toMatch(/clos|dispos/i);

    const lateErr = await runtime.loadFrame(0).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(lateErr).not.toBeNull();
    expect(String(lateErr?.message)).toMatch(/clos|dead|dispos/i);
  });
});

describe("TrajectoryRuntime.openStore (mrec)", () => {
  function frameResult(
    frameId: number,
    sectionUpdates: Record<string, number>,
  ) {
    return {
      kind: "frame" as const,
      frameId,
      blocks: [],
      box: null,
      sectionUpdates,
    };
  }

  it("posts one mrec open job with the store buffers in the transfer list", async () => {
    const fake = new FakeWorkloadWorker((run, worker) => {
      if (run.job.kind === "open") {
        worker.emit({
          type: "done",
          id: run.id,
          result: {
            kind: "open-result",
            frameCount: 4,
            totalBytes: 12,
            indexComplete: true,
          },
        });
      }
    });
    const runtime = new TrajectoryRuntime(fake, "mrec");
    const a = new ArrayBuffer(4);
    const b = new ArrayBuffer(8);
    const opened = await runtime.openStore({
      kind: "mrec-files",
      files: new Map([
        ["zarr.json", a],
        ["trajectory/step/c/0", b],
      ]),
    });
    expect(opened).toEqual({
      frameCount: 4,
      indexedLength: 4,
      length: 4,
      indexComplete: true,
      totalBytes: 12,
    });
    const run = fake.posts.find(
      (p) => (p.msg as { type?: string }).type === "run",
    );
    expect(run).toBeDefined();
    const job = (
      run?.msg as {
        job: { kind: string; format: string; source: { kind: string } };
      }
    ).job;
    expect(job.kind).toBe("open");
    expect(job.format).toBe("mrec");
    expect(job.source.kind).toBe("mrec-files");
    expect(run?.transfer).toEqual([a, b]);
    expect(await runtime.whenIndexComplete).toEqual(opened);
    await runtime.close();
  });

  it("refuses openStore on a byte-stream runtime", async () => {
    const runtime = new TrajectoryRuntime(new FakeWorkloadWorker(), "xyz");
    await expect(
      runtime.openStore({ kind: "mrec-zip", bytes: new ArrayBuffer(1) }),
    ).rejects.toThrow(/needs an mrec runtime/);
    await runtime.close();
  });

  it("remembers each loaded frame's section updates, bounded", async () => {
    const fake = new FakeWorkloadWorker((run, worker) => {
      if (run.job.kind === "load-frame") {
        worker.emit({
          type: "done",
          id: run.id,
          result: frameResult(run.job.frameId, { atoms: run.job.frameId }),
        });
      }
    });
    const runtime = new TrajectoryRuntime(fake, "mrec");
    expect(runtime.sectionUpdates(0)).toBeUndefined();
    for (let i = 0; i < SECTION_UPDATE_LOG_CAPACITY + 2; i++) {
      // The runtime caches the last rehydrated Frame for section-update
      // overlay; the caller must not free it while the runtime still holds it.
      await runtime.loadFrame(i);
    }
    expect(runtime.sectionUpdates(0)).toBeUndefined();
    expect(runtime.sectionUpdates(1)).toBeUndefined();
    expect(runtime.sectionUpdates(2)?.get("atoms")).toBe(2);
    expect(
      runtime.sectionUpdates(SECTION_UPDATE_LOG_CAPACITY + 1)?.get("atoms"),
    ).toBe(SECTION_UPDATE_LOG_CAPACITY + 1);
    await runtime.close();
  });
});
