/**
 * Public-API lock for the range version of the analysis snapshot:
 * `snapshotFramesForAnalysis` packs a strided frame range into one job's
 * snapshots, echoes the source frame numbering, and never frees a frame it was
 * lent.
 *
 * Goldens are literals, hand-written here — no tool, no catalog and no molrs
 * number produced them. The source below is a four-frame table of coordinates
 * written out in full, so stride 2 over `0 … 3` is `[0, 2]` by inspection, its
 * two snapshots carry `frameIndex` `0` and `2` (the source's own numbering, not
 * a renumbered `0, 1`), and their `x` columns are rows 0 and 2 of that table
 * verbatim. The free counter's golden is `0`: molrs frames are handles into
 * WebAssembly memory owned by the trajectory, so a packer that frees one
 * corrupts every later read of it. Recorded 2026-08-14 against
 * `@molcrafts/molvis-stage` at this commit.
 *
 * Run with the repo TS runner: `node regressions/worker-catalog-dispatch-05-snapshots.ts`
 * after `npm run build:stage`.
 *
 * The two preamble hooks are the ones
 * `regressions/worker-catalog-dispatch-01-seams.ts` documents, for the same
 * reason: both functions under test are on the public barrel, and evaluating
 * that barrel under node needs an ESM loader answer for the bundler-target
 * molrs `.wasm` and an `HTMLElement` for `stage/dist/ui/base.js`. The `.wasm`
 * stub is what keeps this script WebAssembly-free — the trajectory, its frames
 * and their atom block are plain JavaScript objects, so no WASM module is
 * instantiated, no molrs call is made, no worker is spawned and no external
 * process runs.
 */
import { registerHooks } from "node:module";
import type {
  AnalysisFrameSnapshot,
  AnalysisTrajectorySource,
  FrameRange,
} from "../stage/dist/index.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

registerHooks({
  load(url, context, next) {
    if (!url.endsWith(".wasm")) return next(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: "export function __wbindgen_start() {}\n",
    };
  },
});

const dom: { HTMLElement?: unknown; customElements?: unknown } = globalThis;
dom.HTMLElement ??= class {};
dom.customElements ??= { define() {}, get: () => undefined };

const { expandFrameRange, snapshotFramesForAnalysis } = await import(
  "../stage/dist/index.js"
);

/**
 * The frame type the packer passes around, taken from the source it reads —
 * naming it this way keeps molrs out of this script's imports entirely
 * (precedent: `regressions/worker-catalog-dispatch-03-runner.ts:39`).
 */
type AnalysisFrame = Awaited<ReturnType<AnalysisTrajectorySource["frame"]>>;

/**
 * Column dtype spellings as molrs `Block.dtype()` reports them. Literals: the
 * `DType` constants that mirror them (`stage/src/utils/dtype.ts`) are internal,
 * so the wire values are what a host-visible fake has to speak.
 */
const F64 = "f64";
const STRING = "string";

/** Positions are copied, never computed — an exact-copy tolerance (Å). */
const POSITION_TOL = 1e-12;

/** One frame of the hand-written source table. Two atoms, no cell. */
interface FrameColumns {
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly z: readonly number[];
  readonly elements: readonly string[];
}

/**
 * Four frames, written out rather than generated so the goldens below can be
 * read straight off this table.
 */
const SOURCE_FRAMES: readonly FrameColumns[] = [
  { x: [0.25, 1.5], y: [0.5, 1.75], z: [0.75, 2.0], elements: ["H", "O"] },
  {
    x: [10.25, 11.5],
    y: [10.5, 11.75],
    z: [10.75, 12.0],
    elements: ["H", "O"],
  },
  {
    x: [20.25, 21.5],
    y: [20.5, 21.75],
    z: [20.75, 22.0],
    elements: ["H", "O"],
  },
  {
    x: [30.25, 31.5],
    y: [30.5, 31.75],
    z: [30.75, 32.0],
    elements: ["H", "O"],
  },
];

/**
 * Every `free()` the packer called, in order. It must stay empty: the frames
 * and their blocks are lent by the trajectory, and the labels are here so a
 * failure names the handle that was released.
 */
const freeCalls: string[] = [];

/** Frame indices the packer asked the source for, in ask order. */
const framesRequested: number[] = [];

/**
 * The whole of an atom block the packer touches: a dtype probe per column, a
 * copy per column, and — for this script's own ownership check afterwards — a
 * row count. Anything else it reaches for stops this script.
 */
interface FakeBlock {
  dtype(key: string): string | undefined;
  copyColF(key: string): Float64Array;
  copyColStr(key: string): string[];
  nrows(): number;
  free(): void;
}

function fakeBlock(columns: FrameColumns, frameIndex: number): FakeBlock {
  const coordinates: Record<string, readonly number[]> = {
    x: columns.x,
    y: columns.y,
    z: columns.z,
  };
  return {
    // No `id` column: `dtype("id")` is undefined, so the snapshot carries none.
    dtype: (key) => {
      if (key in coordinates) return F64;
      return key === "element" ? STRING : undefined;
    },
    copyColF: (key) => {
      const column = coordinates[key];
      if (!column) throw new Error(`no float column "${key}"`);
      return Float64Array.from(column);
    },
    copyColStr: (key) => {
      if (key !== "element") throw new Error(`no string column "${key}"`);
      return [...columns.elements];
    },
    nrows: () => columns.x.length,
    free: () => freeCalls.push(`block:${frameIndex}`),
  };
}

/** A frame with an atoms block and no cell — `box` undefined, so no cell math. */
interface FakeFrame {
  getBlock(name: string): FakeBlock | undefined;
  readonly box: undefined;
  free(): void;
}

function fakeFrame(columns: FrameColumns, frameIndex: number): AnalysisFrame {
  const atoms = fakeBlock(columns, frameIndex);
  const frame: FakeFrame = {
    getBlock: (name) => (name === "atoms" ? atoms : undefined),
    box: undefined,
    free: () => freeCalls.push(`frame:${frameIndex}`),
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
    framesRequested.push(index);
    const frame = this.frames[index];
    if (!frame) throw new Error(`no frame at index ${index}`);
    return frame;
  }
}

function assertColumn(
  column: Float64Array,
  expected: readonly number[],
  label: string,
): void {
  assert(
    column.length === expected.length,
    `${label}: ${column.length} values, expected ${expected.length}`,
  );
  for (let i = 0; i < expected.length; i += 1) {
    assert(
      Math.abs(column[i] - expected[i]) <= POSITION_TOL,
      `${label}[${i}]: ${column[i]}, expected ${expected[i]}`,
    );
  }
}

const source = new FakeTrajectorySource(
  SOURCE_FRAMES.map((columns, index) => fakeFrame(columns, index)),
);

const RANGE: FrameRange = { start: 0, endInclusive: 3, stride: 2 };

// --- The range the snapshots must match, straight from the public expander ---

assert(
  expandFrameRange(source.length, RANGE).join(",") === "0,2",
  `stride 2 over 4 frames expands to ${expandFrameRange(source.length, RANGE).join(",")}`,
);

// --- Two snapshots, source numbering, source coordinates --------------------

const snapshots: AnalysisFrameSnapshot[] = await snapshotFramesForAnalysis(
  source,
  RANGE,
);

assert(snapshots.length === 2, `snapshot count ${snapshots.length}`);
assert(
  snapshots.map((snapshot) => snapshot.frameIndex).join(",") === "0,2",
  `frame indices ${snapshots.map((s) => s.frameIndex).join(",")}`,
);
assert(
  framesRequested.join(",") === "0,2",
  `frames read from the source ${framesRequested.join(",")}`,
);

// Rows 0 and 2 of SOURCE_FRAMES, verbatim: the packer copies, never renumbers
// or re-orders, and a strided range keeps addressing the frames it visited.
assertColumn(snapshots[0].x, [0.25, 1.5], "snapshot 0 x");
assertColumn(snapshots[1].x, [20.25, 21.5], "snapshot 1 x");
assert(
  snapshots[0].elements.join(",") === "H,O",
  `snapshot 0 elements ${snapshots[0].elements.join(",")}`,
);

// A frame with no cell yields a snapshot with no cell — nothing invents one.
assert(
  snapshots[0].boxLengths === undefined &&
    snapshots[0].boxOrigin === undefined &&
    snapshots[0].boxTilts === undefined,
  "a cell-less frame must snapshot without a cell",
);

// --- Ownership: the trajectory still owns every frame it lent ---------------

assert(
  freeCalls.length === 0,
  `the packer released handles it was only lent: ${freeCalls.join(" ")}`,
);
// Still readable afterwards, which is what "not freed" means in practice.
assert(
  source.frames.every(
    (frame) => (frame as unknown as FakeFrame).getBlock("atoms")?.nrows() === 2,
  ),
  "source frames must stay readable after packing",
);

console.log("worker-catalog-dispatch-05-snapshots ok");
