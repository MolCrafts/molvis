/**
 * Contract lock for the two trajectory runners: one strided walk over a frame
 * source, one feed-and-read accumulation on top of it, and the cancellation
 * marker both raise.
 *
 * Goldens are literals, hand-computed from the frame ranges below (no molrs
 * numbers are involved): stride 2 over a 4-frame source visits `[0, 2]`; a
 * visit that throws on one frame leaves exactly 1 failure and one fewer result;
 * an unstrided 4-frame accumulation feeds the sink 4 times and answers with
 * whatever `sink.result()` said; an already-aborted run rejects with
 * `AnalysisAbortError` before any frame is touched.
 *
 * Run with the repo TS runner: `node regressions/worker-catalog-dispatch-03-runner.ts`
 * after `npm run build:stage`.
 *
 * `trajectory_runner` is a kernel seam and by invariant is on no public barrel,
 * so it is pinned here at its build-output deep path — same convention as
 * `regressions/worker-catalog-dispatch-02-marshal.ts`. That import is also why
 * this script needs no loader shim: the module's whole runtime closure is
 * `utils/dtype` + `utils/yield_ui`, neither of which imports anything at all.
 * The frame source and the sink below are plain objects; no WebAssembly (WASM)
 * module is instantiated, no molrs call is made, and no external process runs.
 */
import {
  type AnalysisTrajectorySource,
  runTrajectoryAccumulate,
  runTrajectoryFrames,
  type TrajectoryAccumulateSink,
} from "../stage/dist/analysis/trajectory_runner.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

/**
 * The frame type the runner passes around, taken from the source it reads —
 * naming it this way keeps molrs out of this script's imports entirely.
 */
type AnalysisFrame = Awaited<ReturnType<AnalysisTrajectorySource["frame"]>>;

/**
 * The whole of a frame the runner touches for a whole-frame selection: the atom
 * block's row count. If it ever reaches for more, this script stops passing.
 */
interface FakeFrame {
  getBlock(name: string): { nrows(): number } | undefined;
}

function fakeFrame(atomCount: number): AnalysisFrame {
  const frame: FakeFrame = {
    getBlock: (name) =>
      name === "atoms" ? { nrows: () => atomCount } : undefined,
  };
  // molrs `Frame` is a WASM handle class, so a structural stand-in needs one
  // deliberate cast. It lives here alone.
  return frame as unknown as AnalysisFrame;
}

/** "How many frames" and "the frame at an index" — the whole source surface. */
class FakeTrajectorySource implements AnalysisTrajectorySource {
  // A plain field, not a constructor parameter property: node's TypeScript
  // support strips types only, and parameter properties are not erasable.
  readonly frames: readonly AnalysisFrame[];

  constructor(frames: readonly AnalysisFrame[]) {
    this.frames = frames;
  }

  get length(): number {
    return this.frames.length;
  }

  async frame(index: number): Promise<AnalysisFrame> {
    const frame = this.frames[index];
    if (!frame) throw new Error(`no frame at index ${index}`);
    return frame;
  }
}

/** Counts what it was fed; never asked to release itself. */
class CountingSink implements TrajectoryAccumulateSink<string> {
  feeds = 0;

  feed(): void {
    this.feeds += 1;
  }

  result(): string {
    return `fed:${this.feeds}`;
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

function fourFrames(): FakeTrajectorySource {
  return new FakeTrajectorySource([
    fakeFrame(3),
    fakeFrame(3),
    fakeFrame(3),
    fakeFrame(3),
  ]);
}

// --- runTrajectoryFrames: a strided walk visits 0 and 2, in that order -------

const visited: number[] = [];
const strided = await runTrajectoryFrames(
  {
    trajectory: fourFrames(),
    selection: { kind: "all" },
    run: { frameRange: { start: 0, endInclusive: 3, stride: 2 } },
  },
  ({ frameIndex }) => {
    visited.push(frameIndex);
    return frameIndex * 10;
  },
);

assert(visited.join(",") === "0,2", `visit order ${visited.join(",")}`);
assert(
  strided.frameIndices.join(",") === "0,2",
  `planned frames ${strided.frameIndices.join(",")}`,
);
assert(
  strided.results.map((item) => item.value).join(",") === "0,20",
  `per-frame values ${strided.results.map((item) => item.value).join(",")}`,
);
assert(
  strided.failures.length === 0,
  `clean run failures ${strided.failures.length}`,
);
assert(
  strided.trackedSelection?.mode === "all",
  `tracking mode ${strided.trackedSelection?.mode}`,
);

// --- runTrajectoryFrames: one bad frame is recorded, the walk goes on --------

const reported: number[] = [];
const withFailure = await runTrajectoryFrames(
  {
    trajectory: fourFrames(),
    selection: { kind: "all" },
    run: { onFrameError: (failure) => reported.push(failure.frameIndex) },
  },
  ({ frameIndex }) => {
    if (frameIndex === 1) throw new Error("kernel blew up on frame 1");
    return frameIndex;
  },
);

assert(
  withFailure.failures.length === 1,
  `failures ${withFailure.failures.length}`,
);
assert(
  withFailure.failures[0].frameIndex === 1,
  `failed frame ${withFailure.failures[0].frameIndex}`,
);
assert(reported.join(",") === "1", `onFrameError frames ${reported.join(",")}`);
// One fewer result than planned frames — the run did not stop at the bad frame.
assert(
  withFailure.results.map((item) => item.frameIndex).join(",") === "0,2,3",
  `surviving frames ${withFailure.results.map((i) => i.frameIndex).join(",")}`,
);

// --- runTrajectoryAccumulate: four frames in, sink.result() out -------------

const sink = new CountingSink();
const accumulated = await runTrajectoryAccumulate(
  { trajectory: fourFrames(), selection: { kind: "all" }, run: {} },
  sink,
);

assert(sink.feeds === 4, `sink feeds ${sink.feeds}`);
assert(
  accumulated.fedFrameIndices.join(",") === "0,1,2,3",
  `fed frames ${accumulated.fedFrameIndices.join(",")}`,
);
// The value is the sink's answer, verbatim — the runner reduces nothing itself.
assert(accumulated.value === "fed:4", `accumulated value ${accumulated.value}`);
assert(
  accumulated.failures.length === 0,
  `accumulate failures ${accumulated.failures.length}`,
);

// --- Cancellation: both runners raise the same marker ----------------------

const aborted = new AbortController();
aborted.abort();

const frameAbort = await rejection(
  runTrajectoryFrames(
    {
      trajectory: fourFrames(),
      selection: { kind: "all" },
      run: { abortSignal: aborted.signal },
    },
    ({ frameIndex }) => frameIndex,
  ),
);

assert(
  frameAbort.name === "AnalysisAbortError",
  `frame-run abort name ${frameAbort.name}`,
);

const abortSink = new CountingSink();
const accumulateAbort = await rejection(
  runTrajectoryAccumulate(
    {
      trajectory: fourFrames(),
      selection: { kind: "all" },
      run: { abortSignal: aborted.signal },
    },
    abortSink,
  ),
);

assert(
  accumulateAbort.name === "AnalysisAbortError",
  `accumulate abort name ${accumulateAbort.name}`,
);
// A cancelled run never reads the sink: it keeps whatever it had accumulated.
assert(abortSink.feeds === 0, `feeds after abort ${abortSink.feeds}`);

console.log("worker-catalog-dispatch-03-runner ok");
