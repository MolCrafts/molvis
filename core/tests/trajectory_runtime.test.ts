import { describe, expect, it } from "@rstest/core";
import { BlobRangeSource } from "../src/io/sources";
import {
  type FrameMessage,
  type IndexProgress,
  type IndexReady,
  type OpenError,
  type OpenRequest,
  TrajectoryRuntime,
  type WorkerLike,
  type WorkerRequest,
  type WorkerResponse,
} from "../src/transport/trajectory_worker";

/** Fake `Worker` for unit tests — synchronous message round-trip via a
 *  user-supplied handler. Each test wires the handler to whatever
 *  responses the runtime should see.
 *
 *  Posts a `worker-heartbeat` to the runtime as soon as the listener
 *  registers, mirroring what the real worker does at module init. The
 *  runtime's `open()` blocks on this signal — without it the open
 *  promise hangs. */
class FakeWorker implements WorkerLike {
  private listeners: Array<(e: MessageEvent) => void> = [];
  public posts: WorkerRequest[] = [];
  public terminated = false;

  constructor(
    private readonly respond: (req: WorkerRequest, fake: FakeWorker) => void,
  ) {}

  postMessage(message: unknown, _transfer?: Transferable[]): void {
    const req = message as WorkerRequest;
    this.posts.push(req);
    // schedule on a microtask so the runtime gets to register its
    // pending entry before we deliver the response
    queueMicrotask(() => this.respond(req, this));
  }

  addEventListener(
    _type: "message",
    listener: (e: MessageEvent) => void,
  ): void {
    this.listeners.push(listener);
    // Mimic the real worker emitting a heartbeat once it has
    // registered its own message listener — runtime.open() awaits
    // this before posting any outbound message.
    queueMicrotask(() => {
      this.emit({
        kind: "worker-heartbeat",
        // biome-ignore lint/suspicious/noExplicitAny: heartbeat is
        // intentionally outside the WorkerResponse union — it's a
        // ready signal, not a real response.
      } as any);
    });
  }

  removeEventListener(
    _type: "message",
    listener: (e: MessageEvent) => void,
  ): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Test helper: dispatch a synthetic response to all registered listeners. */
  emit(msg: WorkerResponse): void {
    const event = { data: msg } as MessageEvent;
    for (const l of this.listeners) l(event);
  }
}

function blobSource(content: string): BlobRangeSource {
  return new BlobRangeSource(new Blob([content]));
}

describe("TrajectoryRuntime", () => {
  it("resolves open() once worker reports index-ready", async () => {
    const worker = new FakeWorker((req, fake) => {
      const open = req as OpenRequest;
      const ready: IndexReady = {
        kind: "index-ready",
        requestId: open.requestId,
        frameCount: 7,
        totalBytes: 12345,
      };
      fake.emit(ready);
    });
    const runtime = new TrajectoryRuntime(worker, "lammps-dump");

    const result = await runtime.open(blobSource("ITEM: TIMESTEP\n0\n…"));
    expect(result.frameCount).toBe(7);
    expect(result.totalBytes).toBe(12345);
    expect(worker.posts[0]?.kind).toBe("open");
  });

  it("forwards index-progress events to the onProgress callback", async () => {
    const events: number[] = [];
    const worker = new FakeWorker((req, fake) => {
      const open = req as OpenRequest;
      const progress: IndexProgress = {
        kind: "index-progress",
        requestId: open.requestId,
        bytesScanned: 100,
        totalBytes: 200,
        framesIndexedSoFar: 3,
      };
      fake.emit(progress);
      const ready: IndexReady = {
        kind: "index-ready",
        requestId: open.requestId,
        frameCount: 5,
        totalBytes: 200,
      };
      fake.emit(ready);
    });
    const runtime = new TrajectoryRuntime(worker, "xyz");

    await runtime.open(blobSource("..."), {
      onProgress: (e) => events.push(e.bytesScanned),
    });
    expect(events).toEqual([100]);
  });

  it("rejects open() on open-error", async () => {
    const worker = new FakeWorker((req, fake) => {
      const open = req as OpenRequest;
      const err: OpenError = {
        kind: "open-error",
        requestId: open.requestId,
        message: "bad format",
      };
      fake.emit(err);
    });
    const runtime = new TrajectoryRuntime(worker, "pdb");

    await expect(runtime.open(blobSource(""))).rejects.toThrow(/bad format/);
  });

  it("loadFrame() rehydrates a real molrs Frame from a frame message", async () => {
    const worker = new FakeWorker((req, fake) => {
      // Only respond to load-frame in this test.
      if (req.kind !== "load-frame") return;
      const frame: FrameMessage = {
        kind: "frame",
        requestId: req.requestId,
        frameId: req.frameId,
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
        simbox: null,
        grids: [],
      };
      fake.emit(frame);
    });
    const runtime = new TrajectoryRuntime(worker, "xyz");

    const frame = await runtime.loadFrame(0);
    const atoms = frame.getBlock("atoms");
    expect(atoms?.nrows()).toBe(3);
    expect(Array.from(atoms?.copyColF("x") ?? [])).toEqual([1, 2, 3]);
  });

  it("rejects loadFrame() on frame-error", async () => {
    const worker = new FakeWorker((req, fake) => {
      if (req.kind !== "load-frame") return;
      fake.emit({
        kind: "frame-error",
        requestId: req.requestId,
        frameId: req.frameId,
        message: "out of range",
      });
    });
    const runtime = new TrajectoryRuntime(worker, "lammps-dump");

    await expect(runtime.loadFrame(99)).rejects.toThrow(/out of range/);
  });

  it("close() terminates the worker and rejects in-flight requests", async () => {
    // Worker swallows requests so the loadFrame promise stays pending.
    const worker = new FakeWorker(() => {});
    const runtime = new TrajectoryRuntime(worker, "lammps-dump");

    const pending = runtime.loadFrame(0);
    await runtime.close();
    expect(worker.terminated).toBe(true);
    await expect(pending).rejects.toThrow(/closed/);
  });

  it("post-close calls reject without re-posting to the worker", async () => {
    const worker = new FakeWorker(() => {});
    const runtime = new TrajectoryRuntime(worker, "lammps-dump");
    await runtime.close();

    await expect(runtime.loadFrame(0)).rejects.toThrow(/closed/);
    // close() posts one CloseRequest; loadFrame post-close must NOT post.
    const kinds = worker.posts.map((p) => p.kind);
    expect(kinds.filter((k) => k === "load-frame").length).toBe(0);
  });

  it("forwards opts.fingerprint into the open request payload", async () => {
    const worker = new FakeWorker((req, fake) => {
      const open = req as OpenRequest;
      const ready: IndexReady = {
        kind: "index-ready",
        requestId: open.requestId,
        frameCount: 1,
        totalBytes: 4,
      };
      fake.emit(ready);
    });
    const runtime = new TrajectoryRuntime(worker, "xyz");

    await runtime.open(blobSource("abcd"), { fingerprint: "fp-abc" });
    const open = worker.posts.find((p) => p.kind === "open") as OpenRequest;
    expect(open.fingerprint).toBe("fp-abc");
  });

  it("omits fingerprint when caller passes none", async () => {
    const worker = new FakeWorker((req, fake) => {
      const open = req as OpenRequest;
      const ready: IndexReady = {
        kind: "index-ready",
        requestId: open.requestId,
        frameCount: 0,
        totalBytes: 0,
      };
      fake.emit(ready);
    });
    const runtime = new TrajectoryRuntime(worker, "lammps-dump");

    await runtime.open(blobSource(""));
    const open = worker.posts.find((p) => p.kind === "open") as OpenRequest;
    expect(open.fingerprint).toBeUndefined();
  });
});
