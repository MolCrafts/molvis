import { Block, Frame } from "@molcrafts/molvis-core/molrs";
import { describe, expect, it } from "@rstest/core";
import {
  AnalysisAbortError,
  type AnalysisProgress,
  type AnalysisTrajectorySource,
  expandFrameRange,
  resolveTrackedAtomIndices,
  resolveTrackedAtomSelection,
  runTrajectoryAccumulate,
  runTrajectoryFrames,
  type TrajectoryAccumulateSink,
} from "../../src/analysis/trajectory_runner";
import { Trajectory } from "../../src/system/trajectory";
import { type ColumnDType, DType } from "../../src/utils/dtype";

function makeFrame(xs: number[], ids?: number[]): Frame {
  const frame = new Frame();
  const atoms = new Block();
  atoms.setColF("x", Float64Array.from(xs));
  atoms.setColF("y", new Float64Array(xs.length));
  atoms.setColF("z", new Float64Array(xs.length));
  atoms.setColStr(
    "element",
    Array.from({ length: xs.length }, () => "Ar"),
  );
  if (ids) atoms.setColU32("id", Uint32Array.from(ids));
  frame.insertBlock("atoms", atoms);
  return frame;
}

// ---------------------------------------------------------------------------
// Structural frame source.
//
// The runner is supposed to need nothing but "how many frames" and "the frame
// at an index" (`AnalysisTrajectorySource`), and of a frame nothing but its
// atom count — plus the `id` column when a subset selection has to be followed
// across frames. The fakes below are exactly that surface and nothing else, so
// these cases neither load WebAssembly nor depend on the concrete stage
// `Trajectory`: if the runner ever reaches for more, they stop compiling.
// ---------------------------------------------------------------------------

/** The `Block` surface `trajectory_runner` reads: row count + the `id` column. */
interface FakeAtomsBlock {
  nrows(): number;
  dtype(column: string): ColumnDType | undefined;
  copyColU32(column: string): Uint32Array | undefined;
}

interface FakeFrame {
  getBlock(name: string): FakeAtomsBlock | undefined;
}

/**
 * A frame with `atomCount` rows and, when `ids` is given, a molrs-canonical
 * `id` column (u32) for id-based atom tracking.
 */
function fakeFrame(atomCount: number, ids?: readonly number[]): Frame {
  const atoms: FakeAtomsBlock = {
    nrows: () => atomCount,
    dtype: (column) => (column === "id" && ids ? DType.U32 : undefined),
    copyColU32: (column) =>
      column === "id" && ids ? Uint32Array.from(ids) : undefined,
  };
  const frame: FakeFrame = {
    getBlock: (name) => (name === "atoms" ? atoms : undefined),
  };
  // molrs `Frame` is a WebAssembly handle class, so a structural stand-in needs
  // one deliberate cast. It lives here alone — no test body carries an escape.
  return frame as unknown as Frame;
}

/** A frame whose rows are identified by `ids`, in row order. */
function fakeIdFrame(ids: readonly number[]): Frame {
  return fakeFrame(ids.length, ids);
}

class FakeTrajectorySource implements AnalysisTrajectorySource {
  /** Frame indices asked for, in order — including the reference-frame read. */
  readonly requested: number[] = [];

  constructor(private readonly frames: readonly Frame[]) {}

  get length(): number {
    return this.frames.length;
  }

  async frame(index: number): Promise<Frame> {
    this.requested.push(index);
    const frame = this.frames[index];
    if (!frame) {
      throw new Error(`FakeTrajectorySource: no frame at index ${index}`);
    }
    return frame;
  }
}

/** Await a run expected to reject, and hand back its `Error` type-safely. */
async function rejection(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`expected an Error, got ${String(error)}`);
  }
  throw new Error("expected the run to reject, but it resolved");
}

describe("analysis trajectory runner", () => {
  it("expands inclusive frame ranges with stride", () => {
    expect(
      expandFrameRange(10, { start: 2, endInclusive: 8, stride: 3 }),
    ).toEqual([2, 5, 8]);
    expect(expandFrameRange(3, { start: -5, endInclusive: 99 })).toEqual([
      0, 1, 2,
    ]);
    expect(expandFrameRange(5, { start: 4, endInclusive: 1 })).toEqual([]);
  });

  it("tracks selected atoms by stable id columns across row reordering", () => {
    const first = makeFrame([0, 1, 2], [10, 20, 30]);
    const second = makeFrame([2, 0, 1], [30, 10, 20]);
    const tracked = resolveTrackedAtomSelection(first, {
      kind: "indices",
      indices: [1, 2],
    });

    expect(tracked.mode).toBe("id-column");
    expect(tracked.idColumn).toBe("id");

    const resolved = resolveTrackedAtomIndices(second, tracked);
    expect(resolved.ok).toBe(true);
    expect(resolved.indices).toEqual([2, 0]);
  });

  it("fails row-index tracking when topology changes", () => {
    const first = makeFrame([0, 1, 2]);
    const second = makeFrame([0, 1]);
    const tracked = resolveTrackedAtomSelection(first, {
      kind: "indices",
      indices: [1, 2],
    });

    expect(tracked.mode).toBe("row-index");
    const resolved = resolveTrackedAtomIndices(second, tracked);
    expect(resolved.ok).toBe(false);
  });

  it("runs sampled frames without moving trajectory currentIndex", async () => {
    const trajectory = new Trajectory([
      makeFrame([0]),
      makeFrame([1]),
      makeFrame([2]),
      makeFrame([3]),
    ]);
    trajectory.seek(1);

    const seen: number[] = [];
    const result = await runTrajectoryFrames(
      {
        trajectory,
        selection: { kind: "all" },
        run: { frameRange: { start: 0, endInclusive: 3, stride: 2 } },
      },
      ({ frameIndex }) => {
        seen.push(frameIndex);
        return frameIndex * 10;
      },
    );

    expect(trajectory.currentIndex).toBe(1);
    expect(seen).toEqual([0, 2]);
    expect(result.results.map((item) => item.value)).toEqual([0, 20]);
    expect(result.failures).toEqual([]);
  });
});

describe("TestRunTrajectoryFrames", () => {
  it("visits a strided range of a structural frame source in order", async () => {
    const source = new FakeTrajectorySource([
      fakeFrame(3),
      fakeFrame(3),
      fakeFrame(3),
      fakeFrame(3),
      fakeFrame(3),
    ]);

    const seen: number[] = [];
    const ordinals: number[] = [];
    const totals: number[] = [];
    const result = await runTrajectoryFrames(
      {
        trajectory: source,
        selection: { kind: "all" },
        run: { frameRange: { start: 0, endInclusive: 4, stride: 2 } },
      },
      ({ frameIndex, ordinal, total }) => {
        seen.push(frameIndex);
        ordinals.push(ordinal);
        totals.push(total);
        return frameIndex * 10;
      },
    );

    expect(seen).toEqual([0, 2, 4]);
    // `ordinal` counts visits, `frameIndex` addresses the source — a strided
    // range is where the two diverge.
    expect(ordinals).toEqual([0, 1, 2]);
    expect(totals).toEqual([3, 3, 3]);
    expect(result.frameIndices).toEqual([0, 2, 4]);
    expect(result.results.map((item) => item.frameIndex)).toEqual([0, 2, 4]);
    expect(result.results.map((item) => item.value)).toEqual([0, 20, 40]);
    expect(result.failures).toEqual([]);
    expect(result.trackedSelection?.mode).toBe("all");
  });

  it("records one failure and one fewer result when a visit throws", async () => {
    const source = new FakeTrajectorySource([
      fakeFrame(2),
      fakeFrame(2),
      fakeFrame(2),
    ]);
    const seenErrors: number[] = [];

    const result = await runTrajectoryFrames(
      {
        trajectory: source,
        selection: { kind: "all" },
        run: { onFrameError: (failure) => seenErrors.push(failure.frameIndex) },
      },
      ({ frameIndex }) => {
        if (frameIndex === 1) throw new Error("kernel blew up on frame 1");
        return frameIndex;
      },
    );

    expect(result.frameIndices).toEqual([0, 1, 2]);
    expect(result.results.map((item) => item.frameIndex)).toEqual([0, 2]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].frameIndex).toBe(1);
    expect(result.failures[0].error.message).toBe("kernel blew up on frame 1");
    expect(seenErrors).toEqual([1]);
  });

  it("beats progress once per planned frame, failed frames included", async () => {
    const source = new FakeTrajectorySource([
      fakeFrame(2),
      fakeFrame(2),
      fakeFrame(2),
      fakeFrame(2),
    ]);
    const beats: AnalysisProgress[] = [];

    await runTrajectoryFrames(
      {
        trajectory: source,
        selection: { kind: "all" },
        run: {
          frameRange: { start: 0, endInclusive: 3, stride: 1 },
          onProgress: (progress) => beats.push({ ...progress }),
        },
      },
      ({ frameIndex }) => {
        if (frameIndex === 1 || frameIndex === 2) throw new Error("bad frame");
        return frameIndex;
      },
    );

    // Four planned frames, two of them failed → still four beats, one per
    // frame, `completed` counting up to `total`. `job_runner` maps these back
    // to source frame numbers, so a dropped beat silently breaks framesVisited.
    expect(beats).toHaveLength(4);
    expect(beats.map((beat) => beat.completed)).toEqual([1, 2, 3, 4]);
    expect(beats.map((beat) => beat.total)).toEqual([4, 4, 4, 4]);
    expect(beats.map((beat) => beat.frameIndex)).toEqual([0, 1, 2, 3]);
  });

  it("rejects with AnalysisAbortError when the signal is already aborted", async () => {
    const source = new FakeTrajectorySource([fakeFrame(2), fakeFrame(2)]);
    const controller = new AbortController();
    controller.abort();
    let visited = 0;

    const error = await rejection(
      runTrajectoryFrames(
        {
          trajectory: source,
          selection: { kind: "all" },
          run: { abortSignal: controller.signal },
        },
        () => {
          visited += 1;
          return visited;
        },
      ),
    );

    expect(error.name).toBe("AnalysisAbortError");
    expect(error).toBeInstanceOf(AnalysisAbortError);
    expect(visited).toBe(0);
  });
});

describe("TestRunTrajectoryFramesMissingTrackedAtoms", () => {
  /**
   * Atom `30` is present in the reference frame, gone from frame 1, back in
   * frame 2 — so the tracked selection resolves for frames 0 and 2 and fails
   * for frame 1 alone.
   */
  function sourceLosingAnAtom(): FakeTrajectorySource {
    return new FakeTrajectorySource([
      fakeIdFrame([10, 20, 30]),
      fakeIdFrame([10, 20]),
      fakeIdFrame([10, 20, 30]),
    ]);
  }

  it("skip-frame (the default) records a failure and keeps going", async () => {
    const source = sourceLosingAnAtom();
    const seen: number[] = [];

    const result = await runTrajectoryFrames(
      {
        trajectory: source,
        selection: { kind: "indices", indices: [1, 2] },
        run: {},
      },
      ({ frameIndex }) => {
        seen.push(frameIndex);
        return frameIndex;
      },
    );

    expect(result.trackedSelection?.mode).toBe("id-column");
    expect(seen).toEqual([0, 2]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].frameIndex).toBe(1);
    expect(result.results.map((item) => item.frameIndex)).toEqual([0, 2]);
  });

  it("throw fails the whole run at the first unresolvable frame", async () => {
    const source = sourceLosingAnAtom();
    const seen: number[] = [];

    const error = await rejection(
      runTrajectoryFrames(
        {
          trajectory: source,
          selection: { kind: "indices", indices: [1, 2] },
          run: { missingTrackedAtoms: "throw" },
        },
        ({ frameIndex }) => {
          seen.push(frameIndex);
          return frameIndex;
        },
      ),
    );

    // "throw" ends the walk at the first unresolvable frame (the tracked-atom
    // verdict is taken before the per-frame try — see prepareFrame in
    // trajectory_runner.ts), so frame 2 is never visited.
    expect(error.message).toMatch(/frame 1/);
    expect(error.name).not.toBe("AnalysisAbortError");
    expect(seen).toEqual([0]);
  });
});

describe("TestRunTrajectoryAccumulate", () => {
  /**
   * Records what the runner feeds it, and whether the runner ever tried to
   * release it — the sink is the caller's handle to own, so a runner that
   * disposes one it did not build would free a molrs handle out from under its
   * owner.
   */
  class CountingSink implements TrajectoryAccumulateSink<string> {
    readonly fed: Array<readonly number[] | undefined> = [];
    readonly ownershipCalls: string[] = [];
    resultCalls = 0;

    feed(_frame: Frame, atomIndices?: readonly number[]): void {
      this.fed.push(atomIndices);
    }

    result(): string {
      this.resultCalls += 1;
      return `fed:${this.fed.length}`;
    }

    dispose(): void {
      this.ownershipCalls.push("dispose");
    }

    free(): void {
      this.ownershipCalls.push("free");
    }

    close(): void {
      this.ownershipCalls.push("close");
    }

    reset(): void {
      this.ownershipCalls.push("reset");
    }
  }

  it("feeds every visited frame and reports them in visit order", async () => {
    const source = new FakeTrajectorySource([
      fakeFrame(3),
      fakeFrame(3),
      fakeFrame(3),
      fakeFrame(3),
    ]);
    const sink = new CountingSink();

    const result = await runTrajectoryAccumulate(
      {
        trajectory: source,
        selection: { kind: "all" },
        run: { frameRange: { start: 0, endInclusive: 3, stride: 2 } },
      },
      sink,
    );

    expect(sink.fed).toHaveLength(2);
    expect(result.fedFrameIndices).toEqual([0, 2]);
    expect(result.frameIndices).toEqual([0, 2]);
    expect(result.failures).toEqual([]);
  });

  it("takes its value from sink.result()", async () => {
    const source = new FakeTrajectorySource([
      fakeFrame(2),
      fakeFrame(2),
      fakeFrame(2),
    ]);
    const sink = new CountingSink();

    const result = await runTrajectoryAccumulate(
      { trajectory: source, selection: { kind: "all" }, run: {} },
      sink,
    );

    expect(result.value).toBe("fed:3");
    expect(sink.resultCalls).toBe(1);
  });

  it("feeds a whole-frame selection with no atom indices at all", async () => {
    const source = new FakeTrajectorySource([fakeFrame(4), fakeFrame(4)]);
    const sink = new CountingSink();

    const result = await runTrajectoryAccumulate(
      { trajectory: source, selection: { kind: "all" }, run: {} },
      sink,
    );

    // "all" means the kernel eats the raw frame — no sub-frame is built, so
    // the second argument must be absent rather than 0..n-1.
    expect(sink.fed).toEqual([undefined, undefined]);
    expect(result.trackedSelection?.mode).toBe("all");
  });

  it("feeds a subset selection the row indices resolved per frame", async () => {
    const source = new FakeTrajectorySource([
      fakeIdFrame([10, 20, 30, 40]),
      fakeIdFrame([40, 30, 20, 10]),
    ]);
    const sink = new CountingSink();

    const result = await runTrajectoryAccumulate(
      {
        trajectory: source,
        selection: { kind: "indices", indices: [1, 3] },
        run: {},
      },
      sink,
    );

    // Atoms 20 and 40: rows 1 and 3 in the reference frame, rows 2 and 0 once
    // the dump reorders them.
    expect(result.trackedSelection?.mode).toBe("id-column");
    expect(sink.fed).toEqual([
      [1, 3],
      [2, 0],
    ]);
  });

  it("skips a frame whose tracked atoms are gone and keeps feeding", async () => {
    const source = new FakeTrajectorySource([
      fakeIdFrame([10, 20, 30]),
      fakeIdFrame([10, 20]),
      fakeIdFrame([30, 20, 10]),
    ]);
    const sink = new CountingSink();

    const result = await runTrajectoryAccumulate(
      {
        trajectory: source,
        selection: { kind: "indices", indices: [1, 2] },
        run: {},
      },
      sink,
    );

    expect(result.fedFrameIndices).toEqual([0, 2]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].frameIndex).toBe(1);
    expect(sink.fed).toEqual([
      [1, 2],
      [1, 0],
    ]);
  });

  it("never releases a sink it did not build", async () => {
    const source = new FakeTrajectorySource([fakeFrame(2), fakeFrame(2)]);
    const sink = new CountingSink();

    await runTrajectoryAccumulate(
      { trajectory: source, selection: { kind: "all" }, run: {} },
      sink,
    );

    expect(sink.ownershipCalls).toEqual([]);
  });
});
