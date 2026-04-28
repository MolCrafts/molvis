/**
 * Generate ribbon mesh geometry from spline points and secondary
 * structure data.
 *
 * All three secondary-structure types share a single rounded-rectangle
 * cross-section parameterization — only the (width, height, cornerRadius)
 * triple changes. Coil degenerates to a circle (radius = min/2), sheet
 * to an almost-flat strap with a tiny fillet (so its edges still catch
 * light), and helix sits in between as a thick ribbon with prominent
 * fillets. This gives every SS type a continuously curved surface with
 * the same vertex topology, which keeps the strip indices fixed and
 * lets us blend profile parameters smoothly across SS boundaries.
 *
 * Sheet runs end with the Richardson-style arrowhead taper: the last
 * `SHEET_ARROW_POINTS` spline points fan out to `SHEET_ARROW_HEAD_SCALE`
 * × the base width, then narrow linearly to a point.
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
  cornerRadius: number;
}

const SS_PROFILES: Record<SecondaryStructureType, CrossSectionProfile> = {
  // Helix: classic PyMOL-style flat ribbon with a near-stadium cross
  // section (fillets eat almost the full short side), so the silhouette
  // reads as "thick rounded plank" rather than a sharp slab.
  helix: { width: 1.8, height: 0.5, cornerRadius: 0.22 },
  // Sheet: wide thin strap with very small fillets — sharp enough to
  // read as paper-flat, fileted just enough that the edges don't shade
  // identically to the faces (so the sheet has visible thickness).
  sheet: { width: 2.0, height: 0.22, cornerRadius: 0.025 },
  // Coil: round wire — full fillet (radius = min/2 → circle).
  coil: { width: 0.42, height: 0.42, cornerRadius: 0.21 },
};

/** Cross-section vertex count. 16 keeps tubes visibly smooth without
 * blowing out the vertex budget; sheets need this density too because
 * the fillet curves consume ~6 of the 16 verts. */
const CROSS_SECTION_SEGMENTS = 16;

/** Number of trailing sheet spline points that form the arrowhead. */
const SHEET_ARROW_POINTS = 6;
/** Width multiplier at the *base* of the arrowhead (widest). */
const SHEET_ARROW_HEAD_SCALE = 1.7;

/**
 * Compute per-spline-point cross-section parameters after applying:
 *   1. Per-residue SS lookup.
 *   2. A 3-point box-smoothing pass that softens SS boundaries (a
 *      sudden helix→coil transition would otherwise show as a visible
 *      kink in the mesh).
 *   3. Sheet arrowhead taper at the tail of every maximal sheet run.
 *
 * Smoothing runs *before* the arrowhead so the tip stays crisp.
 */
function computePointProfiles(
  ssPerPoint: SecondaryStructureType[],
  widthScale: number,
): { widths: Float32Array; heights: Float32Array; radii: Float32Array } {
  const n = ssPerPoint.length;
  const widths = new Float32Array(n);
  const heights = new Float32Array(n);
  const radii = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = SS_PROFILES[ssPerPoint[i]];
    widths[i] = p.width * widthScale;
    heights[i] = p.height;
    radii[i] = p.cornerRadius;
  }

  if (n >= 3) {
    const sw = widths.slice();
    const sh = heights.slice();
    const sr = radii.slice();
    for (let i = 1; i < n - 1; i++) {
      widths[i] = (sw[i - 1] + 2 * sw[i] + sw[i + 1]) * 0.25;
      heights[i] = (sh[i - 1] + 2 * sh[i] + sh[i + 1]) * 0.25;
      radii[i] = (sr[i - 1] + 2 * sr[i] + sr[i + 1]) * 0.25;
    }
  }

  let i = 0;
  while (i < n) {
    if (ssPerPoint[i] !== "sheet") {
      i++;
      continue;
    }
    let j = i;
    while (j < n && ssPerPoint[j] === "sheet") j++;
    const baseWidth = SS_PROFILES.sheet.width * widthScale;
    const headStart = Math.max(i, j - SHEET_ARROW_POINTS);
    const tailLen = j - headStart;
    for (let k = 0; k < tailLen; k++) {
      const t = k / Math.max(1, tailLen - 1);
      const scale = SHEET_ARROW_HEAD_SCALE * (1 - t) + 0.05 * t;
      widths[headStart + k] = baseWidth * scale;
    }
    i = j;
  }

  return { widths, heights, radii };
}

/**
 * Sample one (u, v, nu, nv) tuple along a rounded-rectangle perimeter.
 * Walks the perimeter starting from the +U-axis midpoint and going
 * counter-clockwise.
 *
 * Layout of the rounded rectangle (full W × H, corner radius r):
 *   - 2 horizontal straight edges of length (W − 2r)
 *   - 2 vertical straight edges of length (H − 2r)
 *   - 4 quarter-circle arcs of length (πr/2) each
 * Total perimeter: 2(W − 2r) + 2(H − 2r) + 2πr.
 *
 * Outward normals are unit vectors; on straight edges they point along
 * the edge's outward axis, and on arcs they point radially from the
 * arc's centre. This gives crisp shading on the flat sides and smooth
 * shading on the fillets.
 */
function sampleRoundedRect(
  s: number,
  W: number,
  H: number,
  r: number,
  out: Float32Array,
): void {
  const halfW = W * 0.5;
  const halfH = H * 0.5;
  const sw = Math.max(0, W - 2 * r);
  const sh = Math.max(0, H - 2 * r);
  const arc = Math.PI * r * 0.5;

  const e1 = sh * 0.5;
  const e2 = e1 + arc;
  const e3 = e2 + sw;
  const e4 = e3 + arc;
  const e5 = e4 + sh;
  const e6 = e5 + arc;
  const e7 = e6 + sw;
  const e8 = e7 + arc;

  if (s < e1) {
    out[0] = halfW;
    out[1] = s;
    out[2] = 1;
    out[3] = 0;
  } else if (s < e2) {
    const theta = r > 1e-8 ? (s - e1) / r : 0;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    out[0] = halfW - r + r * c;
    out[1] = halfH - r + r * sn;
    out[2] = c;
    out[3] = sn;
  } else if (s < e3) {
    out[0] = halfW - r - (s - e2);
    out[1] = halfH;
    out[2] = 0;
    out[3] = 1;
  } else if (s < e4) {
    const theta = r > 1e-8 ? (s - e3) / r + Math.PI * 0.5 : Math.PI * 0.5;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    out[0] = -halfW + r + r * c;
    out[1] = halfH - r + r * sn;
    out[2] = c;
    out[3] = sn;
  } else if (s < e5) {
    out[0] = -halfW;
    out[1] = halfH - r - (s - e4);
    out[2] = -1;
    out[3] = 0;
  } else if (s < e6) {
    const theta = r > 1e-8 ? (s - e5) / r + Math.PI : Math.PI;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    out[0] = -halfW + r + r * c;
    out[1] = -halfH + r + r * sn;
    out[2] = c;
    out[3] = sn;
  } else if (s < e7) {
    out[0] = -halfW + r + (s - e6);
    out[1] = -halfH;
    out[2] = 0;
    out[3] = -1;
  } else if (s < e8) {
    const theta = r > 1e-8 ? (s - e7) / r + Math.PI * 1.5 : Math.PI * 1.5;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    out[0] = halfW - r + r * c;
    out[1] = -halfH + r + r * sn;
    out[2] = c;
    out[3] = sn;
  } else {
    out[0] = halfW;
    out[1] = -halfH + r + (s - e8);
    out[2] = 1;
    out[3] = 0;
  }
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

  const { widths, heights, radii } = computePointProfiles(
    ssPerPoint,
    widthScale,
  );

  const sample = new Float32Array(4);

  for (let i = 0; i < nPts; i++) {
    const pt = splinePoints[i];
    const color = colorPerPoint[i];

    // Cross-section frame:
    //   u-axis (width)  = side vector  (sx, sy, sz)
    //   v-axis (height) = tangent × side  (perpendicular to ribbon plane)
    //
    // For a β-strand, the side vector lies in the strand plane, so the
    // wide flat face of the ribbon ends up coplanar with the strand —
    // matching biological convention. For a helix, side rotates
    // smoothly around the helical axis, giving the classic "twisted
    // tape" look without per-residue flips.
    const bx = pt.ty * pt.sz - pt.tz * pt.sy;
    const by = pt.tz * pt.sx - pt.tx * pt.sz;
    const bz = pt.tx * pt.sy - pt.ty * pt.sx;

    const W = widths[i];
    const H = heights[i];
    const r = Math.min(radii[i], W * 0.5, H * 0.5);

    const sw = Math.max(0, W - 2 * r);
    const sh = Math.max(0, H - 2 * r);
    const arc = Math.PI * r * 0.5;
    const perimeter = 2 * sw + 2 * sh + 4 * arc;

    for (let j = 0; j <= nSeg; j++) {
      // j = nSeg duplicates j = 0 to seal the ring without an index seam.
      const tParam = (j % nSeg) / nSeg;
      const s = tParam * perimeter;
      sampleRoundedRect(s, W, H, r, sample);
      const u = sample[0];
      const v = sample[1];
      const nu = sample[2];
      const nv = sample[3];

      const offX = u * pt.sx + v * bx;
      const offY = u * pt.sy + v * by;
      const offZ = u * pt.sz + v * bz;

      const idx = (i * verticesPerRing + j) * 3;
      positions[idx + 0] = pt.x + offX;
      positions[idx + 1] = pt.y + offY;
      positions[idx + 2] = pt.z + offZ;

      const nx = nu * pt.sx + nv * bx;
      const ny = nu * pt.sy + nv * by;
      const nz = nu * pt.sz + nv * bz;
      const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const inv = nLen > 1e-8 ? 1 / nLen : 0;
      normals[idx + 0] = nx * inv;
      normals[idx + 1] = ny * inv;
      normals[idx + 2] = nz * inv;

      const cIdx = (i * verticesPerRing + j) * 4;
      colors[cIdx + 0] = color[0];
      colors[cIdx + 1] = color[1];
      colors[cIdx + 2] = color[2];
      colors[cIdx + 3] = 1.0;
    }
  }

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
