import { AtomSpecies, PeriodicTableElements } from "@molcrafts/molvis-core";
/**
 * Read a molrs `compute` call's data off frames.
 *
 * molrs computes take data, never a `Frame` (`compute({ positions, simbox,
 * … })`, field names from `ComputeSpec.inputs`). Reading frame columns is the
 * caller's job, and this module is molvis's one implementation of it: every
 * {@link InputSource} a catalog row may name is filled here, once.
 *
 * - {@link FrameInputs} fills a per-frame data object from one frame.
 * - {@link TrajectoryInputs} stacks the per-frame rows of a time series as
 *   frames are fed, and fills the data object once at the end.
 *
 * Both own whatever WASM handles they build (neighbor tables, a cell copy, an
 * upstream result) until {@link FrameInputs.dispose} — the compute borrows
 * them through `clone()`, so they are freed after it returns.
 *
 * Kernel-safe: molrs, `../algo/neighbor_list`, `../io/atom_coords` and the
 * molrs-only analysis modules. It runs on the main thread and in the analysis
 * worker alike.
 */

import {
  Cluster,
  covalentRadius,
  type Frame,
  type Neighbors,
  RadicalVoronoi,
  Steinhardt,
  Vacf,
} from "@molcrafts/molvis-core/molrs";
import { SpatialNeighborQuery } from "../algo/neighbor_list";
import { viewAtomCoords } from "../io/atom_coords";
import {
  angleTriples,
  atomLabels,
  bondPairs,
  dihedralQuads,
  voidMask,
} from "./panel_inputs";
import type { AnalysisDefinition, AnalysisInputSpec } from "./registry";
import { AnalysisUnsupportedError } from "./trajectory_runner";

/** Coerced parameter values, by key (spec name for `ctor`, molvis key for `call`). */
export type ResolvedParams = Readonly<Record<string, unknown>>;

/** A WASM handle this module built and must free. */
interface Owned {
  free(): void;
}

/** A shaped array as molrs reads it: `{ dim, data }`, row-major. */
export interface ShapedArray {
  dim: number[];
  data: Float64Array;
}

function atomCount(frame: Frame): number {
  return frame.has("atoms") ? frame.get("atoms").nRows : 0;
}

/** Atom x/y/z as one flat `[x0, y0, z0, x1, …]` array (N × 3). */
export function flatPositions(
  frame: Frame,
  definitionId: string,
  rows?: readonly number[],
): Float64Array {
  const coords = frame.has("atoms")
    ? viewAtomCoords(frame.get("atoms"))
    : undefined;
  if (!coords) {
    throw new AnalysisUnsupportedError(
      definitionId,
      "the frame has no atom x/y/z columns",
    );
  }
  return interleave([coords.x, coords.y, coords.z], rows);
}

/** Interleave equally long columns row by row, optionally only `rows`. */
function interleave(
  columns: readonly ArrayLike<number>[],
  rows?: readonly number[],
): Float64Array {
  const width = columns.length;
  const count = rows ? rows.length : (columns[0]?.length ?? 0);
  const out = new Float64Array(count * width);
  for (let i = 0; i < count; i++) {
    const row = rows ? rows[i] : i;
    for (let c = 0; c < width; c++) out[i * width + c] = columns[c][row];
  }
  return out;
}

/** A numeric `call` parameter, refusing anything that is not a finite number. */
function numberParam(params: ResolvedParams, key: string): number {
  const value = params[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`parameter ${key} must be a number, got ${String(value)}`);
  }
  return value;
}

/**
 * The data object of one frame-form compute call, read off one frame.
 *
 * Built per frame and disposed after the compute call that reads it.
 */
export class FrameInputs {
  private readonly owned: Owned[] = [];
  private neighborCache: Neighbors | undefined;

  constructor(
    private readonly frame: Frame,
    private readonly definition: AnalysisDefinition,
    private readonly params: ResolvedParams,
    private readonly selected: readonly number[],
  ) {}

  /**
   * Every input the definition sources, by its `compute` field name. An
   * optional input with no source, or an optional cell the frame lacks, is
   * left off.
   *
   * @throws AnalysisUnsupportedError when the frame cannot supply an input
   */
  data(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const input of this.definition.inputs) {
      if (!input.source) continue;
      const value = this.read(input);
      if (value === undefined) {
        if (input.optional) continue;
        throw new AnalysisUnsupportedError(
          this.definition.id,
          `the frame cannot supply ${input.name}`,
        );
      }
      out[input.name] = value;
    }
    return out;
  }

  /** Free every handle built for this frame. */
  dispose(): void {
    for (const handle of this.owned.splice(0)) handle.free();
    this.neighborCache = undefined;
  }

  private own<T extends Owned>(handle: T): T {
    this.owned.push(handle);
    return handle;
  }

  private read(input: AnalysisInputSpec): unknown {
    switch (input.source) {
      case "positions":
        return flatPositions(this.frame, this.definition.id);
      case "box": {
        const box = this.frame.box;
        return box ? this.own(box) : undefined;
      }
      case "boxVolume": {
        const box = this.frame.box;
        if (!box) return undefined;
        try {
          return box.volume();
        } finally {
          box.free();
        }
      }
      case "neighbors":
        return this.neighbors();
      case "clusters":
        return this.own(
          this.own(
            new Cluster(numberParam(this.params, "min_cluster_size")),
          ).compute({ pairs: this.neighbors() }),
        );
      case "labels":
        return Uint32Array.from(
          atomLabels(this.frame, String(this.params.label_by)),
        );
      case "masses":
        return this.masses();
      case "radii":
        return this.radii();
      case "bondTuples":
        return this.bondTuples();
      case "voidMask":
        return voidMask(atomCount(this.frame), this.selected);
      case "voronoiCells":
        return this.voronoiCells();
      case "qlm":
        return this.qlm();
      case "timestep":
        return numberParam(this.params, "dt");
      case "descriptors":
        throw new AnalysisUnsupportedError(
          this.definition.id,
          "it needs a descriptor matrix, which no frame carries",
        );
      default:
        throw new AnalysisUnsupportedError(
          this.definition.id,
          `${input.name} is a time series, not per-frame data`,
        );
    }
  }

  private neighbors(): Neighbors {
    if (!this.neighborCache) {
      // Distances and displacements both: the orientational analyses read
      // the pair vectors, the radial ones the distances.
      const query = new SpatialNeighborQuery(
        numberParam(this.params, this.definition.neighborCutoff),
        { distSq: true, disp: true },
      );
      try {
        this.neighborCache = this.own(query.build(this.frame));
      } finally {
        query.free();
      }
    }
    return this.neighborCache;
  }

  /** The `mass` column when the frame has one, uniform 1 otherwise. */
  private masses(): Float64Array {
    const n = atomCount(this.frame);
    const atoms = this.frame.has("atoms") ? this.frame.get("atoms") : null;
    if (atoms?.has("mass")) {
      return Float64Array.from(atoms.copy("mass") as Float64Array);
    }
    return new Float64Array(n).fill(1);
  }

  /** Covalent radii by element, or uniform 1 when `use_atom_radii` is off. */
  private radii(): Float64Array {
    const n = atomCount(this.frame);
    if (this.params.use_atom_radii !== true) return new Float64Array(n).fill(1);
    const atoms = this.frame.get("atoms");
    if (!new AtomSpecies(atoms).has()) {
      throw new AnalysisUnsupportedError(
        this.definition.id,
        "covalent radii need an `element` column",
      );
    }
    const elements = new AtomSpecies(atoms).symbols();
    return Float64Array.from(elements, (element) => {
      const radius = covalentRadius(
        PeriodicTableElements.find((entry) => entry.symbol === element)
          ?.atomicNumber ?? 0,
      );
      if (radius === undefined) {
        throw new AnalysisUnsupportedError(
          this.definition.id,
          `no covalent radius for element "${element}"`,
        );
      }
      return radius;
    });
  }

  /** Pairs, angle triples or dihedral quads off the bonds block, by observable. */
  private bondTuples(): Uint32Array {
    const observable = this.params.observable;
    const tuples =
      observable === "angle"
        ? angleTriples(this.frame)
        : observable === "dihedral"
          ? dihedralQuads(this.frame)
          : bondPairs(this.frame);
    if (tuples.length === 0) {
      throw new AnalysisUnsupportedError(
        this.definition.id,
        "the frame's bonds block yields no atom groups",
      );
    }
    return tuples;
  }

  private voronoiCells(): unknown {
    const box = this.frame.box;
    if (!box) {
      throw new AnalysisUnsupportedError(
        this.definition.id,
        "a Voronoi tessellation needs the frame's cell",
      );
    }
    this.own(box);
    return this.own(
      this.own(new RadicalVoronoi()).compute({
        positions: flatPositions(this.frame, this.definition.id),
        simbox: box,
        radii: this.radii(),
      }),
    );
  }

  private qlm(): unknown {
    const l = numberParam(this.params, "l");
    const result = this.own(
      this.own(new Steinhardt(new Uint32Array([l]))).compute({
        neighbors: this.neighbors(),
      }),
    );
    const table = result.qlm(l);
    if (!table) throw new Error(`Steinhardt returned no q_lm table for l=${l}`);
    return this.own(table);
  }
}

/**
 * The data object of a trajectory-form compute call: per-frame rows stacked as
 * frames are fed, assembled once by {@link TrajectoryInputs.data}.
 */
export class TrajectoryInputs {
  private readonly positions: Float64Array[] = [];
  private readonly velocities: Float64Array[] = [];
  private width = -1;

  constructor(private readonly definition: AnalysisDefinition) {}

  private needs(source: string): boolean {
    return this.definition.inputs.some((input) => input.source === source);
  }

  /** Frames fed so far. */
  get count(): number {
    return Math.max(this.positions.length, this.velocities.length);
  }

  /**
   * Copy one frame's rows — only `atomIndices` when given.
   *
   * @throws Error when the atom count differs from the frames fed before
   * @throws AnalysisUnsupportedError when the frame lacks the columns
   */
  feed(frame: Frame, atomIndices?: readonly number[]): void {
    const n = atomIndices ? atomIndices.length : atomCount(frame);
    if (this.width >= 0 && n !== this.width) {
      throw new Error(
        `${this.definition.id}: a frame has ${n} atoms, earlier frames ${this.width}`,
      );
    }
    if (this.needs("positionTrajectory")) {
      this.positions.push(
        flatPositions(frame, this.definition.id, atomIndices),
      );
    }
    if (this.needs("velocitySeries") || this.needs("velocityAcf")) {
      const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
      if (!atoms || !["vx", "vy", "vz"].every((key) => atoms.has(key))) {
        throw new AnalysisUnsupportedError(
          this.definition.id,
          "the frame has no vx/vy/vz columns",
        );
      }
      const columns = ["vx", "vy", "vz"].map(
        (key) => atoms.copy(key) as Float64Array,
      );
      this.velocities.push(interleave(columns, atomIndices));
    }
    this.width = n;
  }

  /**
   * The data object for everything fed so far.
   *
   * @throws AnalysisUnsupportedError for a per-frame source in a trajectory
   *   compute
   */
  data(
    params: ResolvedParams,
  ): Record<string, unknown> | Record<string, unknown>[] {
    if (this.definition.form === "Frames") {
      return Array.from({ length: this.count }, (_, index) => {
        const data: Record<string, unknown> = {};
        for (const input of this.definition.inputs) {
          if (input.source === "positionTrajectory") {
            data[input.name] = {
              dim: [this.width, 3],
              data: this.positions[index],
            };
          } else if (input.source === "velocitySeries") {
            data[input.name] = this.velocities[index];
          } else if (input.source === "timestep") {
            data[input.name] = numberParam(params, "dt");
          } else if (!input.optional) {
            throw new AnalysisUnsupportedError(
              this.definition.id,
              `unsupported frame input ${input.name}`,
            );
          }
        }
        return data;
      });
    }
    const out: Record<string, unknown> = {};
    for (const input of this.definition.inputs) {
      switch (input.source) {
        case undefined:
          break;
        case "positionTrajectory":
          out[input.name] = stack(this.positions, [this.width, 3]);
          break;
        case "velocitySeries":
          out[input.name] = stack(this.velocities, [this.width * 3]);
          break;
        case "velocityAcf":
          out[input.name] = this.velocityAcf(params);
          break;
        case "timestep":
          out[input.name] = numberParam(params, "dt");
          break;
        default:
          if (input.optional) break;
          throw new AnalysisUnsupportedError(
            this.definition.id,
            `${input.name} is per-frame data in a trajectory analysis`,
          );
      }
    }
    return out;
  }

  /** The mean velocity autocorrelation of the fed frames, as a signal. */
  private velocityAcf(params: ResolvedParams): Float64Array {
    const vacf = new Vacf(numberParam(params, "max_lag"));
    try {
      const result = vacf.compute(
        this.velocities.map((a) => ({
          a,
          dt: numberParam(params, "dt"),
        })),
      );
      try {
        const values = result.toJSON().values as { data: number[] };
        return Float64Array.from(values.data);
      } finally {
        result.free();
      }
    } finally {
      vacf.free();
    }
  }
}

/** Frame rows, one after another, as a `{ dim: [frames, …row], data }`. */
function stack(rows: readonly Float64Array[], rowDim: number[]): ShapedArray {
  const size = rows[0]?.length ?? 0;
  const data = new Float64Array(rows.length * size);
  for (let i = 0; i < rows.length; i++) data.set(rows[i], i * size);
  return { dim: [rows.length, ...rowDim], data };
}
