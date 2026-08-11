/**
 * Trajectory unwrap state for the pipeline coordinate policy
 * (`unwrap-trajectory`) and {@link UnwrapTrajectoriesModifier}.
 */

import { type Box, WasmArray } from "@molcrafts/molvis-core/molrs";

export interface UnwrapState {
  lastFrameIndex: number;
  prevWrappedX: Float64Array;
  prevWrappedY: Float64Array;
  prevWrappedZ: Float64Array;
  unwrappedX: Float64Array;
  unwrappedY: Float64Array;
  unwrappedZ: Float64Array;
}

export function micDisplacements(
  box: Box,
  ax: Float64Array,
  ay: Float64Array,
  az: Float64Array,
  bx: Float64Array,
  by: Float64Array,
  bz: Float64Array,
  n: number,
): { dx: Float64Array; dy: Float64Array; dz: Float64Array } {
  const a = new Float64Array(n * 3);
  const b = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    a[i3] = ax[i];
    a[i3 + 1] = ay[i];
    a[i3 + 2] = az[i];
    b[i3] = bx[i];
    b[i3 + 1] = by[i];
    b[i3 + 2] = bz[i];
  }
  const aArr = WasmArray.from(a, new Uint32Array([n, 3]));
  const bArr = WasmArray.from(b, new Uint32Array([n, 3]));
  try {
    const delta = box.delta(aArr, bArr, true);
    try {
      const d = delta.toCopy();
      const dx = new Float64Array(n);
      const dy = new Float64Array(n);
      const dz = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        dx[i] = d[i3];
        dy[i] = d[i3 + 1];
        dz[i] = d[i3 + 2];
      }
      return { dx, dy, dz };
    } finally {
      delta.free();
    }
  } finally {
    aArr.free();
    bArr.free();
  }
}

/**
 * One scrub step: seed on first/backward scrub, else accumulate MIC deltas.
 * Returns new coordinates and updated state.
 */
export function stepUnwrap(
  box: Box,
  wx: Float64Array,
  wy: Float64Array,
  wz: Float64Array,
  n: number,
  frameIndex: number,
  state: UnwrapState | null,
): {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  state: UnwrapState;
} {
  const needSeed =
    state === null ||
    state.unwrappedX.length !== n ||
    frameIndex <= state.lastFrameIndex;

  let ux: Float64Array;
  let uy: Float64Array;
  let uz: Float64Array;

  if (needSeed) {
    ux = new Float64Array(wx);
    uy = new Float64Array(wy);
    uz = new Float64Array(wz);
  } else {
    const d = micDisplacements(
      box,
      state.prevWrappedX,
      state.prevWrappedY,
      state.prevWrappedZ,
      wx,
      wy,
      wz,
      n,
    );
    ux = new Float64Array(n);
    uy = new Float64Array(n);
    uz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      ux[i] = state.unwrappedX[i] + d.dx[i];
      uy[i] = state.unwrappedY[i] + d.dy[i];
      uz[i] = state.unwrappedZ[i] + d.dz[i];
    }
  }

  const next: UnwrapState = {
    lastFrameIndex: frameIndex,
    prevWrappedX: new Float64Array(wx),
    prevWrappedY: new Float64Array(wy),
    prevWrappedZ: new Float64Array(wz),
    unwrappedX: ux,
    unwrappedY: uy,
    unwrappedZ: uz,
  };
  return { x: ux, y: uy, z: uz, state: next };
}
