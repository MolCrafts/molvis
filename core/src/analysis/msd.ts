import {
  type Frame,
  MSD as WasmMSD,
  type MSDResult as WasmMSDResult,
} from "@molcrafts/molrs";
import { buildAtomSubFrame } from "./frame_subset";

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
 * Feed frames sequentially — the first frame becomes the reference.
 * All computation is delegated to WASM.
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
  private inner: WasmMSD;

  constructor() {
    this.inner = new WasmMSD();
  }

  /** Feed a frame. First frame becomes reference. */
  feed(frame: Frame, atomIndices?: readonly number[]): void {
    if (!atomIndices) {
      this.inner.feed(frame);
      return;
    }
    const subFrame = buildAtomSubFrame(frame, atomIndices);
    if (!subFrame) {
      throw new Error("MSD: could not build selected-atom frame");
    }
    try {
      this.inner.feed(subFrame);
    } finally {
      subFrame.free();
    }
  }

  /** Number of frames fed so far. */
  get count(): number {
    return this.inner.count;
  }

  /** Get accumulated results. */
  result(): MsdResult {
    const wasmResults: WasmMSDResult[] = this.inner.results();
    const frames: MsdFrameResult[] = wasmResults.map((r) => ({
      mean: r.mean,
      perParticle: new Float32Array(r.perParticle()),
    }));
    // Free WASM result objects
    for (const r of wasmResults) {
      r.free();
    }
    return { frames, count: frames.length };
  }

  /** Reset analyzer (clear reference and results). */
  reset(): void {
    this.inner.reset();
  }

  /** Free WASM resources. */
  dispose(): void {
    this.inner.free();
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
