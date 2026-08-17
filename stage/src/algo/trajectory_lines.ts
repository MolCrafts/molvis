/**
 * Pure helpers for generating trajectory line polylines.
 */

export interface TrajectoryLine {
  /** Interleaved xyz path for one atom (length 3 * nFrames). */
  path: Float64Array;
  atomIndex: number;
}

/**
 * Sample atom positions across frames into polylines.
 *
 * @param frames - list of frames as { x,y,z Float64Array per atom } (same nAtoms)
 * @param atomIndices - which atoms to trace
 * @param frameStride - sample every k-th frame (default 1)
 */
export function buildTrajectoryLines(
  frames: ReadonlyArray<{
    x: ArrayLike<number>;
    y: ArrayLike<number>;
    z: ArrayLike<number>;
  }>,
  atomIndices: readonly number[],
  frameStride = 1,
): TrajectoryLine[] {
  if (frames.length === 0 || atomIndices.length === 0) return [];
  const stride = Math.max(1, Math.floor(frameStride));
  const sampled: number[] = [];
  for (let f = 0; f < frames.length; f += stride) sampled.push(f);
  if (sampled[sampled.length - 1] !== frames.length - 1) {
    sampled.push(frames.length - 1);
  }
  const nF = sampled.length;
  const lines: TrajectoryLine[] = [];
  for (const ai of atomIndices) {
    const path = new Float64Array(nF * 3);
    let ok = true;
    for (let s = 0; s < nF; s++) {
      const fr = frames[sampled[s]];
      if (ai >= fr.x.length) {
        ok = false;
        break;
      }
      path[s * 3] = fr.x[ai];
      path[s * 3 + 1] = fr.y[ai];
      path[s * 3 + 2] = fr.z[ai];
    }
    if (ok) lines.push({ path, atomIndex: ai });
  }
  return lines;
}
