/**
 * Generate ribbon mesh geometry from spline points and secondary
 * structure data.
 *
 * Cross-section profiles are fixed by structural-biology convention:
 * - Helix:  wide oval (width=1.6, height=0.4) — flattened tube
 * - Sheet:  flat strap (width=2.0, height=0.15) — wide and thin
 * - Coil:   thin tube (width=0.3, height=0.3) — round wire
 *
 * Sheet runs end with an **arrow taper**: the last `SHEET_ARROW_POINTS`
 * spline points fan out to `SHEET_ARROW_HEAD_SCALE` × the base width
 * and then narrow linearly to a point. This is the cartoon-ribbon
 * convention introduced by Richardson 1981 and adopted by every
 * modern viewer (PyMOL, ChimeraX, MOL*, NGL).
 *
 * Coloring is *not* fixed — per-vertex RGB is supplied by the caller
 * so `RibbonRenderer` can implement spectrum / by-chain / uniform
 * modes without geometry knowing or caring.
 */

import type { SecondaryStructureType } from "./pdb_backbone";
import type { SplinePoint } from "./spline";

export interface RibbonMeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
}

interface CrossSectionProfile {
  width: number;
  height: number;
}

const SS_PROFILES: Record<SecondaryStructureType, CrossSectionProfile> = {
  helix: { width: 1.6, height: 0.4 },
  sheet: { width: 2.0, height: 0.15 },
  coil: { width: 0.3, height: 0.3 },
};

const CROSS_SECTION_SEGMENTS = 8;

/** Number of trailing sheet spline points that form the arrowhead. */
const SHEET_ARROW_POINTS = 5;
/** Width multiplier at the *base* of the arrowhead (widest). */
const SHEET_ARROW_HEAD_SCALE = 1.5;

/**
 * Compute per-spline-point cross-section width / height after applying
 * sheet-arrow tapers and a global width-scale multiplier. Result has
 * the same length as `ssPerPoint`.
 */
function computePointProfiles(
  ssPerPoint: SecondaryStructureType[],
  widthScale: number,
): { widths: Float32Array; heights: Float32Array } {
  const n = ssPerPoint.length;
  const widths = new Float32Array(n);
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = SS_PROFILES[ssPerPoint[i]];
    widths[i] = p.width * widthScale;
    heights[i] = p.height;
  }

  // Locate every maximal sheet run [start, end] (end exclusive). For
  // each run's tail, replace widths with arrow taper: head wider than
  // base, narrowing linearly to ~0.
  let i = 0;
  while (i < n) {
    if (ssPerPoint[i] !== "sheet") {
      i++;
      continue;
    }
    let j = i;
    while (j < n && ssPerPoint[j] === "sheet") j++;
    // Sheet run is [i, j). Apply arrow at the tail.
    const baseWidth = SS_PROFILES.sheet.width * widthScale;
    const headStart = Math.max(i, j - SHEET_ARROW_POINTS);
    const tailLen = j - headStart;
    for (let k = 0; k < tailLen; k++) {
      const t = k / Math.max(1, tailLen - 1); // 0 at base, 1 at tip
      // head scale 1.5 at t=0, linearly down to 0.05 at t=1
      const scale = SHEET_ARROW_HEAD_SCALE * (1 - t) + 0.05 * t;
      widths[headStart + k] = baseWidth * scale;
    }
    i = j;
  }

  return { widths, heights };
}

/**
 * Build ribbon geometry for one chain.
 *
 * @param splinePoints - Smooth spline points along the backbone.
 * @param ssPerPoint   - Secondary-structure type per spline point.
 * @param colorPerPoint- RGB triple per spline point (each in [0, 1]).
 * @param widthScale   - Multiplier on the SS profile's nominal width.
 */
export function buildRibbonGeometry(
  splinePoints: SplinePoint[],
  ssPerPoint: SecondaryStructureType[],
  colorPerPoint: ReadonlyArray<readonly [number, number, number]>,
  widthScale = 1.0,
): RibbonMeshData {
  const nPts = splinePoints.length;
  const nSeg = CROSS_SECTION_SEGMENTS;
  const verticesPerRing = nSeg + 1;

  const positions = new Float32Array(nPts * verticesPerRing * 3);
  const normals = new Float32Array(nPts * verticesPerRing * 3);
  const colors = new Float32Array(nPts * verticesPerRing * 4);

  const { widths, heights } = computePointProfiles(ssPerPoint, widthScale);

  for (let i = 0; i < nPts; i++) {
    const pt = splinePoints[i];
    const color = colorPerPoint[i];

    // Binormal = tangent × normal
    const bx = pt.ty * pt.nz - pt.tz * pt.ny;
    const by = pt.tz * pt.nx - pt.tx * pt.nz;
    const bz = pt.tx * pt.ny - pt.ty * pt.nx;

    const hw = widths[i] * 0.5;
    const hh = heights[i] * 0.5;

    for (let j = 0; j <= nSeg; j++) {
      const angle = (j / nSeg) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      const offX = pt.nx * cosA * hh + bx * sinA * hw;
      const offY = pt.ny * cosA * hh + by * sinA * hw;
      const offZ = pt.nz * cosA * hh + bz * sinA * hw;

      const idx = (i * verticesPerRing + j) * 3;
      positions[idx + 0] = pt.x + offX;
      positions[idx + 1] = pt.y + offY;
      positions[idx + 2] = pt.z + offZ;

      const nrmLen = Math.sqrt(offX * offX + offY * offY + offZ * offZ);
      const invLen = nrmLen > 1e-8 ? 1 / nrmLen : 0;
      normals[idx + 0] = offX * invLen;
      normals[idx + 1] = offY * invLen;
      normals[idx + 2] = offZ * invLen;

      const cIdx = (i * verticesPerRing + j) * 4;
      colors[cIdx + 0] = color[0];
      colors[cIdx + 1] = color[1];
      colors[cIdx + 2] = color[2];
      colors[cIdx + 3] = 1.0;
    }
  }

  // Triangle-strip indices.
  const numQuads = (nPts - 1) * nSeg;
  const indices = new Uint32Array(numQuads * 6);
  let idx = 0;
  for (let i = 0; i < nPts - 1; i++) {
    for (let j = 0; j < nSeg; j++) {
      const curr = i * verticesPerRing + j;
      const next = (i + 1) * verticesPerRing + j;
      indices[idx++] = curr;
      indices[idx++] = next;
      indices[idx++] = curr + 1;
      indices[idx++] = curr + 1;
      indices[idx++] = next;
      indices[idx++] = next + 1;
    }
  }

  return { positions, normals, indices, colors };
}
