/**
 * Contract lock for live optimize feedback: one worker coords beat becomes one
 * canvas paint — every atom written once, one bond refresh, one upload — and
 * the beat itself stays a structured-cloned copy rather than a transferred
 * buffer.
 *
 * Goldens are literals typed in here, not captured from any tool, optimizer or
 * oracle:
 *
 * - One beat carries `coords = [0.1, 0, 0, 0.9, 0, 0]` Å for `atomCount = 2` —
 *   packed xyz, row `i` is logical atom id `i`. The expected writes are
 *   therefore `writeAtom(0, 0.1, 0, 0)` and `writeAtom(1, 0.9, 0, 0)`: the
 *   beat's numbers reach the edit pool unchanged, which is the whole contract.
 *   Nothing computes them.
 * - Coordinates cross this path as plain doubles (`writeAtom` takes the numbers
 *   the beat carries, no float32 round trip on the way in), so every position
 *   assert is an exact comparison; 0.1 and 0.9 are exact float64 literals and a
 *   tolerance here would hide a precision-losing detour.
 * - Bonds and the GPU upload are per BEAT, not per atom: two beats over two
 *   atoms means four writes, two `refreshBondsAround` calls and two flushes. A
 *   per-atom flush uploads a half-moved molecule.
 *
 * The second half is a build-output scan of the worker-side emitter:
 *
 * - `stage/dist/optimize/job_runner.js` must contain the `"coords"` wire
 *   discriminant — the beat that used to be dropped ("coords stay here"), whose
 *   absence is exactly the "progress bar moves, molecule does not" report. The
 *   QUOTED form is the lock: the bare identifier `coords` predates this spec
 *   (`outcome.coords`, `unpackCoords`) and would pass without an emission.
 * - It must NOT contain `optimizeProgressTransferList`. Coords beats are
 *   structured-cloned on purpose: the workload `reportProgress` takes no
 *   transfer list, and its heartbeat re-posts the last progress verbatim — a
 *   transferred (detached) buffer would throw on that re-post. The rationale
 *   lives as prose in `protocol.ts`'s JSDoc, which compiles into a DIFFERENT
 *   dist module (`protocol.js`), so this scan is not satisfied by the comment
 *   that explains it: only a real transfer-list helper reaching the emitter
 *   trips it.
 *
 * Run with the repo TS runner: `node regressions/optimize-staging-04-live.ts`
 * after `npm run build:stage`.
 *
 * `optimize/live_paint` is a stage-internal seam and by invariant is on no
 * public barrel, so it is pinned at its build-output deep path — same
 * convention as `regressions/optimize-staging-01-positions.ts`. Its runtime
 * closure is types only, so no engine, canvas or scene is created here, no
 * WebAssembly (WASM) module is instantiated, no molrs call is made, no worker
 * is started and no external process runs. Every collaborator below is a plain
 * object.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OptimizeLivePaint } from "../stage/dist/optimize/live_paint.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

/**
 * The two collaborator surfaces and the beat shape, taken from the class
 * itself — that keeps this script's import list at exactly one product module.
 */
type LivePaintWriter = ConstructorParameters<typeof OptimizeLivePaint>[0];
type LivePaintTick = ConstructorParameters<typeof OptimizeLivePaint>[1];
type CoordsBeat = Parameters<OptimizeLivePaint["paint"]>[0];
type WriteAtomArgs = Parameters<LivePaintWriter["writeAtom"]>;

/** Atoms on the canvas when the run started. */
const LIVE_ATOM_COUNT = 2;

/** The edit-pool write door, recording every call verbatim. */
class FakePositions implements LivePaintWriter {
  writes: WriteAtomArgs[];
  refreshedAround: number[][];

  constructor() {
    this.writes = [];
    this.refreshedAround = [];
  }

  writeAtom(...args: WriteAtomArgs): void {
    this.writes.push(args);
  }

  refreshBondsAround(atomIds: Iterable<number>): void {
    this.refreshedAround.push([...atomIds]);
  }
}

/** The upload door; counting is the whole point. */
class FakeTick implements LivePaintTick {
  flushes: number;

  constructor() {
    this.flushes = 0;
  }

  flush(): void {
    this.flushes += 1;
  }
}

/** One worker beat: packed xyz (Å), length 3 · `atomCount`. */
function beat(step: number): CoordsBeat {
  return {
    kind: "coords",
    step,
    maxSteps: 20,
    coords: new Float64Array([0.1, 0, 0, 0.9, 0, 0]),
    atomCount: 2,
  };
}

// --- One beat: the literals reach the edit pool, then one refresh + flush ---

const positions = new FakePositions();
const tick = new FakeTick();
const live = new OptimizeLivePaint(positions, tick, LIVE_ATOM_COUNT);

live.paint(beat(2));

assert(
  positions.writes.length === 2,
  `writeAtom calls ${positions.writes.length}`,
);
assert(
  positions.writes[0].join(",") === "0,0.1,0,0",
  `first write ${positions.writes[0].join(",")}`,
);
assert(
  positions.writes[1].join(",") === "1,0.9,0,0",
  `second write ${positions.writes[1].join(",")}`,
);
assert(
  positions.refreshedAround.length === 1,
  `refreshBondsAround calls ${positions.refreshedAround.length}`,
);
assert(
  positions.refreshedAround[0].join(",") === "0,1",
  `refreshed ids ${positions.refreshedAround[0].join(",")}`,
);
assert(tick.flushes === 1, `flushes after one beat ${tick.flushes}`);

// --- A second beat: refresh and upload are per beat, never per atom ---------

live.paint(beat(4));

assert(
  positions.writes.length === 4,
  `writeAtom calls after two beats ${positions.writes.length}`,
);
assert(
  positions.refreshedAround.length === 2,
  `refreshBondsAround calls after two beats ${positions.refreshedAround.length}`,
);
assert(tick.flushes === 2, `flushes after two beats ${tick.flushes}`);

// --- The worker emits coords beats, and never transfers them ---------------

const jobRunnerJs = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../stage/dist/optimize/job_runner.js",
  ),
  "utf8",
);
assert(
  jobRunnerJs.includes('"coords"'),
  "stage/dist/optimize/job_runner.js emits no coords beat — the minimizer's coordinates are dropped again",
);
assert(
  !jobRunnerJs.includes("optimizeProgressTransferList"),
  "stage/dist/optimize/job_runner.js transfers progress buffers — the workload heartbeat re-posts the last progress and would throw on a detached buffer",
);

console.log("optimize-staging-04-live ok");
