/**
 * Catmull-Rom spline interpolation for backbone traces.
 *
 * Position is interpolated with the standard cubic Catmull-Rom basis
 * over (clamped) Cα control points. The orientation field — the
 * "side vector" `(sx, sy, sz)` along which the ribbon's wide face will
 * be drawn — is interpolated with a parallel-transport-style scheme:
 *
 *   1. Linearly interpolate between the two enclosing residue side
 *      vectors → tentative side.
 *   2. Re-orthogonalize tentative side against the spline tangent
 *      (Gram-Schmidt) so it lies in the cross-section plane.
 *   3. **Sign-continuity vs. previous spline sample** — if the result
 *      flips sign relative to the previous sample (`dot < 0`), flip
 *      it back. This is the safety net that turns "smooth in the
 *      large" into "smooth between every pair of adjacent samples".
 *   4. **Parallel-transport fallback** — if Gram-Schmidt collapses the
 *      tentative side to near-zero (which can happen at sharp
 *      backbone kinks or where the side accidentally aligns with the
 *      tangent), rotate the previous sample's side onto the new
 *      tangent and use that instead. This guarantees the output
 *      orientation field is never undefined.
 *
 * Tangents come from the analytic derivative of the position basis;
 * the explicit last-control-point append uses a finite-difference
 * tangent so the trailing point matches the same conventions as the
 * interior samples.
 */

const ORTHO_FALLBACK_TOL = 1e-3;

export interface SplinePoint {
  x: number;
  y: number;
  z: number;
  /** Unit tangent (along backbone, N → C). */
  tx: number;
  ty: number;
  tz: number;
  /** Unit side vector (perpendicular to tangent; ribbon-width axis).
   *  Originates from per-residue Carson-Bugg vectors and is propagated
   *  with sample-to-sample continuity — see file header. */
  sx: number;
  sy: number;
  sz: number;
  /** Interpolated parameter [0, N-1] — integer values correspond to
   *  input control points. */
  t: number;
}

interface Frame {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  sx: number;
  sy: number;
  sz: number;
}

/**
 * Rotate `prev` (assumed already perpendicular to `prevT`) so it lies
 * perpendicular to `currT`. Equivalent to parallel-transporting the
 * frame along the geodesic on the unit sphere from `prevT` to `currT`.
 *
 * Falls back to copying `prev` unchanged when the two tangents are
 * (anti)parallel — there is no unique rotation in that case, and the
 * sample-to-sample sign check downstream will catch any flip.
 */
function transport(
  prevT: { x: number; y: number; z: number },
  currT: { x: number; y: number; z: number },
  prev: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const ax = prevT.y * currT.z - prevT.z * currT.y;
  const ay = prevT.z * currT.x - prevT.x * currT.z;
  const az = prevT.x * currT.y - prevT.y * currT.x;
  const sinA = Math.sqrt(ax * ax + ay * ay + az * az);
  const cosA = prevT.x * currT.x + prevT.y * currT.y + prevT.z * currT.z;
  if (sinA < 1e-8) return { x: prev.x, y: prev.y, z: prev.z };
  const invSin = 1 / sinA;
  const ux = ax * invSin;
  const uy = ay * invSin;
  const uz = az * invSin;
  // Rodrigues rotation: v' = v cosθ + (u × v) sinθ + u (u·v)(1−cosθ)
  const dot = ux * prev.x + uy * prev.y + uz * prev.z;
  const k = 1 - cosA;
  const cx = uy * prev.z - uz * prev.y;
  const cy = uz * prev.x - ux * prev.z;
  const cz = ux * prev.y - uy * prev.x;
  return {
    x: prev.x * cosA + cx * sinA + ux * dot * k,
    y: prev.y * cosA + cy * sinA + uy * dot * k,
    z: prev.z * cosA + cz * sinA + uz * dot * k,
  };
}

/**
 * Gram-Schmidt: project `(sx, sy, sz)` onto the plane perpendicular
 * to the unit tangent `(tx, ty, tz)`, then renormalize. Returns the
 * pre-normalization length so the caller can detect degeneracy.
 */
function projectAndNormalize(
  sx: number,
  sy: number,
  sz: number,
  tx: number,
  ty: number,
  tz: number,
): { sx: number; sy: number; sz: number; len: number } {
  const dot = sx * tx + sy * ty + sz * tz;
  const px = sx - dot * tx;
  const py = sy - dot * ty;
  const pz = sz - dot * tz;
  const len = Math.sqrt(px * px + py * py + pz * pz);
  if (len < ORTHO_FALLBACK_TOL) return { sx: 0, sy: 0, sz: 0, len };
  const inv = 1 / len;
  return { sx: px * inv, sy: py * inv, sz: pz * inv, len };
}

/**
 * Generate a smooth Catmull-Rom spline through control points.
 *
 * @param positions   - Flat `[x, y, z, …]` per control point (Cα chain).
 * @param sides       - Flat `[sx, sy, sz, …]` per control point. These
 *                      are the per-residue side vectors produced by
 *                      {@link computeSideVectors} (Carson-Bugg + sign
 *                      continuity).
 * @param subdivisions- Interpolation points between each pair of
 *                      control points.
 */
export function catmullRomSpline(
  positions: Float64Array,
  sides: Float64Array,
  subdivisions: number,
): SplinePoint[] {
  const n = positions.length / 3;
  if (n < 2) return [];

  const points: SplinePoint[] = [];
  let prev: Frame | null = null;

  const emit = (frame: Frame, t: number): void => {
    points.push({
      x: frame.x,
      y: frame.y,
      z: frame.z,
      tx: frame.tx,
      ty: frame.ty,
      tz: frame.tz,
      sx: frame.sx,
      sy: frame.sy,
      sz: frame.sz,
      t,
    });
    prev = frame;
  };

  const buildFrame = (
    px: number,
    py: number,
    pz: number,
    tdx: number,
    tdy: number,
    tdz: number,
    targetSx: number,
    targetSy: number,
    targetSz: number,
    _t: number,
  ): Frame => {
    let tx = tdx;
    let ty = tdy;
    let tz = tdz;
    const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tLen > 1e-8) {
      const inv = 1 / tLen;
      tx *= inv;
      ty *= inv;
      tz *= inv;
    } else if (prev) {
      tx = prev.tx;
      ty = prev.ty;
      tz = prev.tz;
    } else {
      tx = 1;
      ty = 0;
      tz = 0;
    }

    let projected = projectAndNormalize(
      targetSx,
      targetSy,
      targetSz,
      tx,
      ty,
      tz,
    );

    // Parallel-transport fallback: the linear-interpolated target side
    // collapsed against the tangent (rare, but possible at sharp
    // kinks). Transport the previous frame's side onto the new tangent.
    if (projected.len < ORTHO_FALLBACK_TOL && prev) {
      const transported = transport(
        { x: prev.tx, y: prev.ty, z: prev.tz },
        { x: tx, y: ty, z: tz },
        { x: prev.sx, y: prev.sy, z: prev.sz },
      );
      projected = projectAndNormalize(
        transported.x,
        transported.y,
        transported.z,
        tx,
        ty,
        tz,
      );
    }

    if (projected.len < ORTHO_FALLBACK_TOL) {
      // Truly degenerate (no previous frame and target collapsed).
      // Synthesize a perpendicular against the world axis least
      // aligned with the tangent.
      const ax = Math.abs(tx);
      const ay = Math.abs(ty);
      const az = Math.abs(tz);
      let rx = 0;
      let ry = 0;
      let rz = 0;
      if (ax <= ay && ax <= az) rx = 1;
      else if (ay <= az) ry = 1;
      else rz = 1;
      projected = projectAndNormalize(rx, ry, rz, tx, ty, tz);
    }

    let { sx, sy, sz } = projected;

    // Sample-to-sample sign continuity. With Carson-Bugg input plus
    // the per-residue sign pass, dot < 0 should be very rare — but
    // when it happens (e.g. the spline crossed a near-zero curvature
    // point between control points) flipping the sample's side keeps
    // the band from twisting 180° in a single segment.
    if (prev) {
      const dot = sx * prev.sx + sy * prev.sy + sz * prev.sz;
      if (dot < 0) {
        sx = -sx;
        sy = -sy;
        sz = -sz;
      }
    }

    return {
      x: px,
      y: py,
      z: pz,
      tx,
      ty,
      tz,
      sx,
      sy,
      sz,
    };
  };

  for (let i = 0; i < n - 1; i++) {
    // Four control points: p0, p1, p2, p3 (clamped at boundaries).
    const i0 = Math.max(0, i - 1);
    const i1 = i;
    const i2 = i + 1;
    const i3 = Math.min(n - 1, i + 2);

    for (let s = 0; s < subdivisions; s++) {
      const t = s / subdivisions;
      const tt = t * t;
      const ttt = tt * t;

      // Catmull-Rom basis functions (position).
      const b0 = -0.5 * ttt + tt - 0.5 * t;
      const b1 = 1.5 * ttt - 2.5 * tt + 1.0;
      const b2 = -1.5 * ttt + 2.0 * tt + 0.5 * t;
      const b3 = 0.5 * ttt - 0.5 * tt;

      // Catmull-Rom basis derivatives (tangent).
      const d0 = -1.5 * tt + 2.0 * t - 0.5;
      const d1 = 4.5 * tt - 5.0 * t;
      const d2 = -4.5 * tt + 4.0 * t + 0.5;
      const d3 = 1.5 * tt - t;

      const px =
        b0 * positions[i0 * 3] +
        b1 * positions[i1 * 3] +
        b2 * positions[i2 * 3] +
        b3 * positions[i3 * 3];
      const py =
        b0 * positions[i0 * 3 + 1] +
        b1 * positions[i1 * 3 + 1] +
        b2 * positions[i2 * 3 + 1] +
        b3 * positions[i3 * 3 + 1];
      const pz =
        b0 * positions[i0 * 3 + 2] +
        b1 * positions[i1 * 3 + 2] +
        b2 * positions[i2 * 3 + 2] +
        b3 * positions[i3 * 3 + 2];

      const tdx =
        d0 * positions[i0 * 3] +
        d1 * positions[i1 * 3] +
        d2 * positions[i2 * 3] +
        d3 * positions[i3 * 3];
      const tdy =
        d0 * positions[i0 * 3 + 1] +
        d1 * positions[i1 * 3 + 1] +
        d2 * positions[i2 * 3 + 1] +
        d3 * positions[i3 * 3 + 1];
      const tdz =
        d0 * positions[i0 * 3 + 2] +
        d1 * positions[i1 * 3 + 2] +
        d2 * positions[i2 * 3 + 2] +
        d3 * positions[i3 * 3 + 2];

      const targetSx = (1 - t) * sides[i1 * 3] + t * sides[i2 * 3];
      const targetSy = (1 - t) * sides[i1 * 3 + 1] + t * sides[i2 * 3 + 1];
      const targetSz = (1 - t) * sides[i1 * 3 + 2] + t * sides[i2 * 3 + 2];

      emit(
        buildFrame(
          px,
          py,
          pz,
          tdx,
          tdy,
          tdz,
          targetSx,
          targetSy,
          targetSz,
          i + t,
        ),
        i + t,
      );
    }
  }

  // Append the last control point with a finite-difference tangent.
  const lastIdx = n - 1;
  const prevIdx = n - 2;
  const tdx = positions[lastIdx * 3] - positions[prevIdx * 3];
  const tdy = positions[lastIdx * 3 + 1] - positions[prevIdx * 3 + 1];
  const tdz = positions[lastIdx * 3 + 2] - positions[prevIdx * 3 + 2];

  emit(
    buildFrame(
      positions[lastIdx * 3],
      positions[lastIdx * 3 + 1],
      positions[lastIdx * 3 + 2],
      tdx,
      tdy,
      tdz,
      sides[lastIdx * 3],
      sides[lastIdx * 3 + 1],
      sides[lastIdx * 3 + 2],
      lastIdx,
    ),
    lastIdx,
  );

  return points;
}
