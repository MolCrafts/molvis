/**
 * Worker-side analysis pipeline — pure molrs (the Rust/WebAssembly molecular
 * core) plus the stage analysis helpers. No Babylon, no DOM, no MolvisApp.
 *
 * Rebuilds a molrs `Frame` per {@link AnalysisFrameSnapshot}, then runs the
 * analysis named by `analysisId` through the same registry and shape dispatch
 * the main thread uses, so a worker run and a main-thread run are the same
 * computation. Which analyses that covers is not a list kept here: every catalog
 * analysis an {@link AnalysisFrameSnapshot} can express runs by its `inputKind`
 * (`snapshotCoversAnalysis` in `./worker_protocol` is the gate), and the two
 * with trajectory-level semantics the catalog cannot state — RDF (radial
 * distribution function: how atom density varies with distance from an atom) and
 * MSD (mean squared displacement: how far atoms have moved from a reference
 * frame) — take the entry-level route in {@link TRAJECTORY_ENTRY_RUNNERS}.
 */

import { Block, Box, Frame } from "@molcrafts/molvis-core/molrs";
import { safeFree } from "../utils/yield_ui";
import { MSD_ANALYSIS_ID, RDF_ANALYSIS_ID } from "./analysis_ids";
import type { PairRepresentation } from "./rdf_params";
import type { AnalysisDefinition } from "./registry";
import { getAnalysisDefinition } from "./registry";
import {
  type AnalysisParamValues,
  CatalogAccumulator,
  PER_FRAME_KINDS,
  runSingleFrame,
} from "./shape_dispatch";
import {
  computeMsdTrajectory,
  computeRdfTrajectory,
} from "./trajectory_analyses";
import {
  AnalysisAbortError,
  type AnalysisAtomSelection,
  type AnalysisFrameFailure,
  type AnalysisRunOptions,
  type AnalysisTrajectorySource,
  AnalysisUnsupportedError,
  runTrajectoryAccumulate,
  runTrajectoryFrames,
  type TrajectoryFrameRunOptions,
} from "./trajectory_runner";
import {
  type AnalysisFrameSnapshot,
  type AnalysisJobPayload,
  type AnalysisJobProgress,
  type AnalysisJobResult,
  type AnalysisShapeResult,
  CELL_TILT_EPS,
  snapshotCoversAnalysis,
} from "./worker_protocol";

/** Cell origin used when a periodic snapshot omits one. */
const DEFAULT_BOX_ORIGIN = [0, 0, 0] as const;

/**
 * The job's frames as molrs frames this worker owns.
 *
 * Satisfies {@link AnalysisTrajectorySource}, so the same trajectory analyses
 * the main thread calls run here with no `System`, no provider and no cache.
 * Every frame is rebuilt from plain snapshot data and freed by
 * {@link SnapshotTrajectory.dispose} — nothing is shared with the main thread.
 */
class SnapshotTrajectory implements AnalysisTrajectorySource {
  private readonly frames: Frame[] = [];
  /** Source trajectory index per frame, in visit order. */
  private readonly sourceIndices: readonly number[];

  constructor(snapshots: readonly AnalysisFrameSnapshot[]) {
    this.sourceIndices = snapshots.map((snapshot) => snapshot.frameIndex);
    try {
      for (const snapshot of snapshots) {
        this.frames.push(SnapshotTrajectory.buildFrame(snapshot));
      }
    } catch (error) {
      // Frames built so far are this object's own; nothing else will free them.
      this.dispose();
      throw error;
    }
  }

  get length(): number {
    return this.frames.length;
  }

  async frame(index: number): Promise<Frame> {
    const frame = this.frames[index];
    if (!frame) {
      throw new Error(`Analysis job: no frame at index ${index}`);
    }
    return frame;
  }

  /**
   * Source trajectory index of the frame at `index` — what progress beats and
   * `framesVisited` report, so a strided frame range stays addressable in the
   * caller's own numbering.
   */
  sourceIndex(index: number): number {
    const source = this.sourceIndices[index];
    if (source === undefined) {
      throw new Error(`Analysis job: no frame at index ${index}`);
    }
    return source;
  }

  /** Free every rebuilt frame. Safe to call twice. */
  dispose(): void {
    for (const frame of this.frames) safeFree(frame);
    this.frames.length = 0;
  }

  private static buildFrame(snapshot: AnalysisFrameSnapshot): Frame {
    const n = snapshot.x.length;
    if (
      snapshot.y.length !== n ||
      snapshot.z.length !== n ||
      snapshot.elements.length !== n
    ) {
      throw new Error(
        `Analysis job: frame ${snapshot.frameIndex} has mismatched ` +
          "x/y/z/elements lengths",
      );
    }
    if (snapshot.ids && snapshot.ids.length !== n) {
      throw new Error(
        `Analysis job: frame ${snapshot.frameIndex} has ${snapshot.ids.length} ` +
          `ids for ${n} atoms`,
      );
    }
    if (snapshot.boxLengths && snapshot.boxLengths.length !== 3) {
      throw new Error(
        `Analysis job: frame ${snapshot.frameIndex} has ` +
          `${snapshot.boxLengths.length} box edge lengths, expected 3`,
      );
    }
    if (snapshot.boxTilts && snapshot.boxTilts.length !== 3) {
      throw new Error(
        `Analysis job: frame ${snapshot.frameIndex} has ` +
          `${snapshot.boxTilts.length} box tilt factors, expected 3`,
      );
    }

    const frame = new Frame();
    const atoms = new Block();
    atoms.setColF("x", snapshot.x);
    atoms.setColF("y", snapshot.y);
    atoms.setColF("z", snapshot.z);
    atoms.setColStr("element", [...snapshot.elements]);
    // The canonical id column is what tracks the same atoms across frames.
    if (snapshot.ids) atoms.setColU32("id", snapshot.ids);
    frame.insertBlock("atoms", atoms);

    if (snapshot.boxLengths) {
      // A cell only when the source frame had one; a snapshot without it runs
      // free boundary (no periodic images).
      // `Frame.box` MOVES the handle it is given, so this attach builds its own
      // Box and nothing else may touch it afterwards.
      const origin =
        snapshot.boxOrigin ?? Float64Array.from(DEFAULT_BOX_ORIGIN);
      // The packer omits tilts within CELL_TILT_EPS, and a hand-built zero
      // triple means the same thing: rebuild the cell as orthorhombic.
      const tilts = snapshot.boxTilts?.some(
        (value) => Math.abs(value) > CELL_TILT_EPS,
      )
        ? snapshot.boxTilts
        : undefined;
      frame.box = tilts
        ? new Box(
            SnapshotTrajectory.hMatrix(snapshot.boxLengths, tilts),
            origin,
            true,
            true,
            true,
          )
        : Box.ortho(snapshot.boxLengths, origin, true, true, true);
    }
    return frame;
  }

  /**
   * Row-major 3×3 h for `new Box(h, …)` from the wire's LAMMPS pair — lattice
   * vectors as the columns of h: `a = (lx, 0, 0)`, `b = (xy, ly, 0)`,
   * `c = (xz, yz, lz)`.
   *
   * Same convention as `hMatrixFromLammps` (`pipeline/draw_box.ts`), spelled out
   * here because that one lives on a Babylon-side pipeline module this
   * worker-only path must not import, and takes tuples rather than the wire's
   * `Float64Array`s.
   */
  private static hMatrix(
    lengths: Float64Array,
    tilts: Float64Array,
  ): Float64Array {
    const [lx, ly, lz] = lengths;
    const [xy, xz, yz] = tilts;
    return Float64Array.from([lx, xy, xz, 0, ly, yz, 0, 0, lz]);
  }
}

/** `value` as a plain record, or `undefined` when it is not object-shaped. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, unknown>;
}

function isPairRepresentation(value: string): value is PairRepresentation {
  return (
    value === "auto" ||
    value === "gr" ||
    value === "pair" ||
    value === "density"
  );
}

/**
 * Reads a job's plain `params` bag into the typed shapes the analyses expect.
 *
 * Values arrive as `unknown` from the wire, so each read is checked and a
 * wrong-typed param fails the job — coercing it would silently run something
 * the caller never configured.
 */
class AnalysisWireParams {
  constructor(private readonly raw: Record<string, unknown>) {}

  /** Finite number under `key`; `undefined` when the param is absent. */
  number(key: string): number | undefined {
    const value = this.raw[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Analysis param "${key}" must be a finite number`);
    }
    return value;
  }

  /** One of the pair-distribution presentation modes. */
  representation(key: string): PairRepresentation | undefined {
    const value = this.raw[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string" || !isPairRepresentation(value)) {
      throw new Error(
        `Analysis param "${key}" must be one of auto / gr / pair / density`,
      );
    }
    return value;
  }

  /**
   * The values of the parameters `definition` declares, as the shape dispatch
   * (`./shape_dispatch`) coerces them.
   *
   * Only declared keys are read, and each present one has to already be a
   * `number` / `boolean` / `string` — the shape a panel puts on
   * {@link AnalysisJobPayload.params} for a catalog parameter. A wrong-typed
   * entry fails the job rather than being converted here: turning the declared
   * kind into the value a binding takes is `coerce`'s single job, and doing half
   * of it here would be the second place that decides what an analysis parameter
   * means. A list-kind parameter (`intList` / `floatList` / `textList`) is no
   * exception — it crosses as the comma-separated string `coerce` parses, never
   * as an array.
   *
   * An absent key is left out rather than defaulted, so `coerce` falls back to
   * that parameter's own `default` — the `AnalysisParamSpec` field in
   * `./registry`.
   *
   * @param definition the catalog entry whose parameters to read
   * @returns the declared parameters that the job actually carries
   * @throws Error naming the parameter whose value is not wire-shaped
   */
  values(definition: AnalysisDefinition): AnalysisParamValues {
    const values: AnalysisParamValues = {};
    for (const spec of definition.params) {
      const value = this.raw[spec.key];
      if (value === undefined || value === null) continue;
      if (
        typeof value !== "number" &&
        typeof value !== "boolean" &&
        typeof value !== "string"
      ) {
        throw new Error(
          `Analysis param "${spec.key}" must be a number, boolean or string`,
        );
      }
      values[spec.key] = value;
    }
    return values;
  }

  /**
   * An atom selection as it crosses the wire: `all`, or explicit `indices`.
   *
   * A `mask` selection is not wire data (it is a live `SelectionMask`), so the
   * main thread resolves it to indices before packing the job.
   */
  selection(key: string): AnalysisAtomSelection | undefined {
    const value = this.raw[key];
    if (value === undefined || value === null) return undefined;
    const record = asRecord(value);
    if (record?.kind === "all") return { kind: "all" };
    if (record?.kind === "indices") {
      if (!Array.isArray(record.indices)) {
        throw new Error(
          `Analysis param "${key}" of kind "indices" needs an indices array`,
        );
      }
      const raw: unknown[] = record.indices;
      const indices: number[] = [];
      for (const entry of raw) {
        if (
          typeof entry !== "number" ||
          !Number.isInteger(entry) ||
          entry < 0
        ) {
          throw new Error(
            `Analysis param "${key}" has a non-index entry ${String(entry)}`,
          );
        }
        indices.push(entry);
      }
      return { kind: "indices", indices };
    }
    throw new Error(
      `Analysis param "${key}" must be an atom selection of kind ` +
        `"all" or "indices"`,
    );
  }
}

/** One analysis that runs as a whole-trajectory entry, not by frame shape. */
type TrajectoryEntryRunner = (
  params: AnalysisWireParams,
  trajectory: AnalysisTrajectorySource,
  run: AnalysisRunOptions,
) => Promise<unknown>;

/**
 * The analyses driven at the trajectory level instead of by catalog shape —
 * a closed table of two, and the only place on the worker path where an
 * analysis id picks a *route*. (Ids are still compared *inside* a shape, to
 * choose what a binding is fed — `runFrameRadii` in `./shape_dispatch` — and to
 * copy an owned result out in `./result_marshal`. Neither decides which
 * computation runs.)
 *
 * **(1) Not "special cases".** Both ids do carry a catalog shape —
 * `rdf.radial_distribution` is `frameNeighbors`, `msd.mean_squared_displacement`
 * is `accumulate` — so shape dispatch would take them without complaint, and
 * what came back would be wrong in two different ways. RDF would be a list of
 * raw per-frame histograms: no group B, and none of `averageRdfResults`' frame
 * mean and count sum, i.e. not the `RdfTrajectoryResult` the RDF panel charts.
 * MSD would be read with the wrong call: its molrs binding answers `results()`
 * — one entry per fed frame, each an owned handle `MsdAnalyzer` (`./msd`) copies
 * out and frees — while `CatalogAccumulator` reads every accumulator with
 * `compute()`, so the series would never leave the binding, and the
 * `MsdTrajectoryResult` envelope around it (which frames were fed, how the atoms
 * were tracked, and the rule that fewer than two fed frames is no series at all)
 * would be gone with it. Trajectory-level semantics are what the molrs compute
 * catalog cannot state, so the two entries state them here — once, on the same
 * `computeRdfTrajectory` / `computeMsdTrajectory` the main-thread panels call,
 * so worker and panel are one computation. The
 * lookalike table in `./result_marshal` fills a *different* catalog hole (no
 * result-serialization metadata); they are not one seam and must not be merged.
 *
 * **(2) It shrinks to nothing** the day molrs publishes trajectory-level RDF and
 * MSD bindings that take a group selection: both entries are deleted and the
 * default branch — catalog shape dispatch — takes them over unchanged.
 *
 * **(3) A third entry is never the answer.** An analysis that shape dispatch
 * cannot run is {@link snapshotCoversAnalysis}'s verdict to give, and the job is
 * refused naming what blocked it. Hand-writing a runner here to get around that
 * verdict is exactly how a route table decays back into the two-id menu this one
 * replaced.
 *
 * Module-level and readonly, keyed by the constants in `./analysis_ids`: an id
 * that is not listed falls through to shape dispatch, so a new catalog analysis
 * needs no edit here.
 */
const TRAJECTORY_ENTRY_RUNNERS: Readonly<
  Record<string, TrajectoryEntryRunner>
> = {
  [RDF_ANALYSIS_ID]: (params, trajectory, run) =>
    computeRdfTrajectory(
      trajectory,
      {
        rMax: params.number("rMax"),
        rMin: params.number("rMin"),
        nBins: params.number("nBins"),
        // From here down is this entry's own wire vocabulary, not catalog
        // parameters: the reference `volume`, the presentation and the two atom
        // groups are nowhere in the definition, so catalog-driven coercion
        // (`coerce` in `./shape_dispatch`) could not produce them even in
        // principle. That is the same gap the entry exists for.
        volume: params.number("volume"),
        representation: params.representation("representation"),
        groupASelection: params.selection("groupASelection"),
        groupBSelection: params.selection("groupBSelection"),
      },
      run,
    ),
  [MSD_ANALYSIS_ID]: (params, trajectory, run) =>
    computeMsdTrajectory(
      trajectory,
      { selection: params.selection("selection") },
      run,
    ),
};

/**
 * Why `definition` cannot run from snapshots, in words, for the refusal.
 *
 * Asks {@link snapshotCoversAnalysis} itself — once with the requirements
 * stripped, then one requirement at a time — instead of restating its rules. A
 * second copy of "what a snapshot covers" living here is precisely the drift
 * that predicate exists to prevent, and a message that outlived the rule it
 * describes is worse than no message.
 */
function snapshotGap(definition: AnalysisDefinition): string {
  if (!snapshotCoversAnalysis({ ...definition, requires: [] })) {
    return `an analysis job snapshot cannot express the ${definition.inputKind} input kind`;
  }
  const blocking = definition.requires.filter(
    (requirement) =>
      !snapshotCoversAnalysis({ ...definition, requires: [requirement] }),
  );
  return `an analysis job snapshot carries no ${blocking.join(", ")}`;
}

/**
 * Run `definition` over the job's frames by its catalog `inputKind`.
 *
 * The shape dispatch is `./shape_dispatch`'s and the frame walking is
 * `./trajectory_runner`'s, so there is no worker-only loop and no worker-only
 * parameter handling: this function only picks per-frame or accumulate, and puts
 * what comes back into the wire envelope.
 *
 * @param definition catalog entry, already admitted by
 *   {@link snapshotCoversAnalysis}
 * @param params the job's `params` bag, read against `definition`
 * @param trajectory the job's own frames, which also map a visited frame back
 *   to the caller's numbering
 * @param run range, progress and cancellation, as the runner takes them
 * @returns the shape envelope, in the caller's frame numbering
 */
async function runByShape(
  definition: AnalysisDefinition,
  params: AnalysisWireParams,
  trajectory: SnapshotTrajectory,
  run: AnalysisRunOptions,
): Promise<AnalysisShapeResult> {
  const values = params.values(definition);
  const frameRun: TrajectoryFrameRunOptions = {
    trajectory,
    // The same `selection` key the MSD entry reads, and what satisfies a
    // `voidMask` requirement — the one requirement a snapshot covers without
    // carrying a column for it.
    selection: params.selection("selection"),
    run,
  };
  // A per-frame failure crosses the wire as plain data: an `Error` keeps its
  // fields through `postMessage` but loses its prototype, so shipping one would
  // hand the caller an object that lies to `instanceof`.
  const wireFailure = (failure: AnalysisFrameFailure) => ({
    frameIndex: trajectory.sourceIndex(failure.frameIndex),
    message: failure.error.message,
  });

  if (PER_FRAME_KINDS.has(definition.inputKind)) {
    const frames = await runTrajectoryFrames<unknown>(
      frameRun,
      ({ frame, atomIndices }) =>
        runSingleFrame(frame, definition, values, atomIndices ?? []),
    );
    return {
      // The frames that produced a payload, not the frames the job listed.
      frameIndices: frames.results.map((item) =>
        trajectory.sourceIndex(item.frameIndex),
      ),
      perFrame: true,
      failures: frames.failures.map(wireFailure),
      value: frames.results.map((item) => ({
        frameIndex: trajectory.sourceIndex(item.frameIndex),
        value: item.value,
      })),
    };
  }

  // `accumulate` — the only kind {@link snapshotCoversAnalysis} admits besides
  // the per-frame ones. MSD is the one accumulator with a driver of its own
  // (`MsdAnalyzer`), and it never arrives here: its id routes to the entry table
  // above, so this branch needs no second opinion about which driver to build.
  const accumulator = new CatalogAccumulator(definition, values);
  try {
    const fed = await runTrajectoryAccumulate(frameRun, accumulator);
    return {
      frameIndices: fed.fedFrameIndices.map((frameIndex) =>
        trajectory.sourceIndex(frameIndex),
      ),
      perFrame: false,
      failures: fed.failures.map(wireFailure),
      value: fed.value,
    };
  } finally {
    accumulator.dispose();
  }
}

/**
 * Run the analysis named by `analysisId` over `trajectory`.
 *
 * Two routes: {@link TRAJECTORY_ENTRY_RUNNERS} for the two trajectory-level
 * analyses, catalog shape dispatch for every other id. The definition is
 * resolved here, on the worker — `getAnalysisCatalog` is memoized and
 * `./registry` depends on molrs alone — so the wire still carries nothing but
 * the id and a plain `params` bag.
 *
 * The ids are the catalog keys (`AnalysisDefinition.id`) from `./analysis_ids`
 * — the same strings the main-thread dispatch and the panels switch on, so
 * there is no short worker-only spelling. Imported by path: this kernel must
 * never reach the analysis barrel.
 *
 * @throws AnalysisUnsupportedError when the catalog carries no such id, or when
 *   an analysis job snapshot cannot express what the analysis needs
 */
function computeByAnalysisId(
  analysisId: string,
  params: AnalysisWireParams,
  trajectory: SnapshotTrajectory,
  run: AnalysisRunOptions,
): Promise<unknown> {
  // Own-property check, not a truthy lookup: an id spelled like an
  // `Object.prototype` member would otherwise resolve to a built-in method.
  if (Object.hasOwn(TRAJECTORY_ENTRY_RUNNERS, analysisId)) {
    return TRAJECTORY_ENTRY_RUNNERS[analysisId](params, trajectory, run);
  }

  const definition = getAnalysisDefinition(analysisId);
  if (!definition) {
    throw new AnalysisUnsupportedError(
      analysisId,
      "the molrs compute catalog carries no analysis with that id",
    );
  }
  if (!snapshotCoversAnalysis(definition)) {
    throw new AnalysisUnsupportedError(analysisId, snapshotGap(definition));
  }
  return runByShape(definition, params, trajectory, run);
}

/**
 * Run one analysis job to completion (or to the first cancel checkpoint).
 *
 * Cooperative cancel: `shouldCancel` is polled between frames, and a cancelled
 * run still resolves — with `cancelled: true`, a `null` payload, and the frames
 * it managed to visit. A job cancelled before it starts answers without
 * rebuilding a single frame.
 *
 * Progress is frame beats only; this runner never emits a `status` line (the one
 * `status` a caller can see comes from the main-thread boot wait). The rebuilt
 * frames are freed before returning, so the result is plain data the caller may
 * keep.
 *
 * @param payload the analysis id, its params, and the frame snapshots to visit
 * @param onProgress called once per frame the run reaches, with source frame
 *   indices (the caller's own numbering), not this job's 0…n−1 positions
 * @param shouldCancel polled before the first frame and again after each one;
 *   the first `true` stops the run at that point
 * @returns the result envelope — on success `framesVisited` lists every
 *   requested frame, on cancel only those actually reached
 * @throws AnalysisUnsupportedError when the catalog carries no `analysisId`, or
 *   when a snapshot cannot express what that analysis needs
 * @throws Error when a `params` entry has the wrong type, when a snapshot is
 *   internally inconsistent (column lengths, cell arity), when the analysis
 *   itself fails, or when the analysis produced nothing (too few frames or
 *   atoms) — never for a cancel
 */
export async function runAnalysisJob(
  payload: AnalysisJobPayload,
  onProgress?: (progress: AnalysisJobProgress) => void,
  shouldCancel?: () => boolean,
): Promise<AnalysisJobResult> {
  /** Source indices of the frames this run actually got through. */
  const visited: number[] = [];
  const cancelled = (): AnalysisJobResult => ({
    analysisId: payload.analysisId,
    cancelled: true,
    payload: null,
    framesVisited: [...visited],
  });

  // Cancelled before any molrs work: answer without rebuilding a single frame.
  if (shouldCancel?.()) return cancelled();

  const controller = new AbortController();
  const frames = new SnapshotTrajectory(payload.frames);
  const run: AnalysisRunOptions = {
    abortSignal: controller.signal,
    onProgress: (progress) => {
      // Cancel is cooperative and lands between frames: raising the flag here
      // makes the analysis throw AnalysisAbortError at its next checkpoint.
      if (shouldCancel?.()) controller.abort();
      const frameIndex = frames.sourceIndex(progress.frameIndex);
      visited.push(frameIndex);
      onProgress?.({
        kind: "frame",
        completed: progress.completed,
        total: progress.total,
        frameIndex,
      });
    },
  };

  try {
    const result = await computeByAnalysisId(
      payload.analysisId,
      new AnalysisWireParams(payload.params),
      frames,
      run,
    );
    if (result === null) {
      throw new Error(
        `${payload.analysisId}: produced no result — too few frames or atoms ` +
          "in the requested range",
      );
    }
    return {
      analysisId: payload.analysisId,
      cancelled: false,
      payload: result,
      framesVisited: payload.frames.map((snapshot) => snapshot.frameIndex),
    };
  } catch (error) {
    if (error instanceof AnalysisAbortError) return cancelled();
    throw error;
  } finally {
    // The rebuilt frames are worker-owned copies and every result is plain
    // arrays by now, so freeing here cannot touch what we return.
    frames.dispose();
  }
}
