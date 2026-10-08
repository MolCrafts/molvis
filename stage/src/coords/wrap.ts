/**
 * Pure PBC atom wrap — the only column-fold helper for the system wrap gate.
 *
 * Edge-bond continuity is draw-time MI (`Box.delta`), not a second rewrite of
 * atom columns.
 */

import { type Box, NDArray } from "@molcrafts/molvis-core/molrs";

/**
 * Wrap each atom independently into the primary cell.
 */
export function wrapAtoms(
  box: Box,
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  atomCount: number,
): { x: Float64Array; y: Float64Array; z: Float64Array } {
  const interleaved = new Float64Array(atomCount * 3);
  for (let i = 0; i < atomCount; i++) {
    const i3 = i * 3;
    interleaved[i3] = x[i];
    interleaved[i3 + 1] = y[i];
    interleaved[i3 + 2] = z[i];
  }
  const coordsArr = NDArray.from(interleaved, new Uint32Array([atomCount, 3]));
  const outX = new Float64Array(atomCount);
  const outY = new Float64Array(atomCount);
  const outZ = new Float64Array(atomCount);
  try {
    const wrapped = box.wrap(coordsArr);
    try {
      const w = wrapped.toCopy();
      for (let i = 0; i < atomCount; i++) {
        const i3 = i * 3;
        outX[i] = w[i3];
        outY[i] = w[i3 + 1];
        outZ[i] = w[i3 + 2];
      }
    } finally {
      wrapped.free();
    }
  } finally {
    coordsArr.free();
  }
  return { x: outX, y: outY, z: outZ };
}
