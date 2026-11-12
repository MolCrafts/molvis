import {
  type Frame,
  type TimeCorrelation,
  Msd as WasmMSD,
} from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";

export interface MsdFrameResult {
  /** System-average MSD in angstrom^2. */
  mean: number;
  /** Per-particle squared displacements in angstrom^2. */
  perParticle: Float32Array;
}

export interface MsdResult {
  /** Per-frame MSD results (index 0 = reference frame, always ~0). */
  frames: MsdFrameResult[];
  /** Number of frames processed. */
  count: number;
}

/**
 * Streaming MSD (Mean Squared Displacement) analyzer.
 *
 * Feed frames sequentially — the first frame becomes the reference. Each feed
 * copies the (selected) atoms' x / y / z rows; {@link MsdAnalyzer.result} stacks
 * them into the `frames × atoms × 3` trajectory molrs `Msd` takes and runs it
 * with a single time origin (`origins: "first"`) and one channel per atom
 * (`reduction: "per_item"`), so lag `t` is exactly frame `t` against frame 0.
 *
 * @example
 * ```ts
 * const analyzer = new MsdAnalyzer();
 * for (const frame of trajectory) {
 *   analyzer.feed(frame);
 * }
 * const result = analyzer.result();
 * analyzer.dispose();
 * ```
 */
export class MsdAnalyzer {
  /** One `atoms × 3` row per fed frame — the analyzer's own accumulator. */
  private rows: Float64Array[] = [];
  private nAtoms: number | null = null;

  /**
   * Feed a frame. First frame becomes reference.
   *
   * @throws Error when the frame has no atom coordinates, or when it holds a
   *   different number of (selected) atoms than the frames before it
   */
  feed(frame: Frame, atomIndices?: readonly number[]): void {
    const atoms = frame.has("atoms") ? frame.get("atoms") : undefined;
    const coords = atoms ? viewAtomCoords(atoms) : undefined;
    if (!atoms || !coords) {
      throw new Error("MSD: the frame has no atom coordinates");
    }
    const indices = atomIndices ?? null;
    const n = indices ? indices.length : atoms.nRows;
    if (this.nAtoms !== null && n !== this.nAtoms) {
      throw new Error(
        `MSD: frame ${this.rows.length} has ${n} atoms, the reference has ${this.nAtoms}`,
      );
    }
    const row = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const atom = indices ? indices[i] : i;
      row[3 * i] = coords.x[atom];
      row[3 * i + 1] = coords.y[atom];
      row[3 * i + 2] = coords.z[atom];
    }
    this.nAtoms = n;
    this.rows.push(row);
  }

  /** Number of frames fed so far. */
  get count(): number {
    return this.rows.length;
  }

  /** Get accumulated results. */
  result(): MsdResult {
    const nFrames = this.rows.length;
    const nAtoms = this.nAtoms ?? 0;
    if (nFrames === 0) return { frames: [], count: 0 };
    if (nFrames === 1) {
      return {
        frames: [{ mean: 0, perParticle: new Float32Array(nAtoms) }],
        count: 1,
      };
    }

    const msd = new WasmMSD(nFrames - 1, "first", "per_item");
    let series: TimeCorrelation | null = null;
    try {
      series = msd.compute(
        this.rows.map((data) => ({
          a: { dim: [nAtoms, 3], data },
          dt: 1,
        })),
      );
      const { values } = series.toJSON() as {
        values: { dim: number[]; data: number[] };
      };
      const frames: MsdFrameResult[] = Array.from(
        { length: nFrames },
        (_, t) => {
          const perParticle = Float32Array.from(
            values.data.slice(t * nAtoms, (t + 1) * nAtoms),
          );
          let sum = 0;
          for (let i = 0; i < nAtoms; i++) sum += values.data[t * nAtoms + i];
          return { mean: nAtoms > 0 ? sum / nAtoms : 0, perParticle };
        },
      );
      return { frames, count: frames.length };
    } finally {
      series?.free();
      msd.free();
    }
  }

  /** Reset analyzer (clear reference and results). */
  reset(): void {
    this.rows = [];
    this.nAtoms = null;
  }

  /** Release what the analyzer holds. It owns no WASM memory between calls. */
  dispose(): void {
    this.reset();
  }
}

/**
 * Compute MSD for an array of frames (convenience wrapper).
 *
 * @param frames - Array of frames. frames[0] is the reference.
 * @returns MSD result with per-frame mean and per-particle values.
 */
export function computeMsd(
  frames: Frame[],
  atomIndicesByFrame?: readonly (readonly number[] | undefined)[],
): MsdResult | null {
  if (frames.length < 2) return null;

  const analyzer = new MsdAnalyzer();
  try {
    for (let i = 0; i < frames.length; i++) {
      analyzer.feed(frames[i], atomIndicesByFrame?.[i]);
    }
    return analyzer.result();
  } finally {
    analyzer.dispose();
  }
}
