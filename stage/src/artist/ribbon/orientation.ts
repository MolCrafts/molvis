/**
 * Per-residue ribbon orientation frame derived from CA-only geometry
 * (Carson & Bugg 1986). This module exists because the obvious
 * "use the carbonyl O − CA vector" approach catastrophically fails on
 * β-strands: consecutive carbonyls strictly alternate ±180° in the
 * extended conformation, which forces the ribbon's width axis to flip
 * once per residue and produces the well-known "twisted leaf" /
 * tornado artefact in long sheets.
 *
 * Carson-Bugg sidesteps this by deriving the **side vector** (the
 * direction along which the ribbon's wide face will be drawn) from
 * three consecutive Cα positions only:
 *
 *     side[i] = normalize( (CA[i] − CA[i−1]) × (CA[i+1] − CA[i]) )
 *
 * Geometrically, this is the local backbone-curvature axis. For an
 * α-helix it rotates smoothly around the helical axis; for a β-strand
 * it points stably out of the strand plane; for a coil it follows the
 * local curvature without singularities (except where the chain is
 * exactly straight — handled below).
 *
 * Two further passes turn the raw Carson-Bugg field into a
 * draw-ready frame:
 *
 *   1. **Sign continuity** — even Carson-Bugg can locally flip sign at
 *      inflection points (where the curvature passes through zero).
 *      A single forward pass `if dot(side[i], side[i−1]) < 0 negate`
 *      removes those flips so the resulting field is C¹ along the
 *      chain.
 *
 *   2. **Boundary fill / degeneracy fallback** — Carson-Bugg is
 *      undefined at chain ends and at points of zero curvature
 *      (three collinear Cαs). In both cases we copy the nearest
 *      well-defined neighbour and, as a last resort, synthesize a
 *      vector perpendicular to the local tangent.
 *
 * The output of this module is the input to {@link catmullRomSpline}'s
 * `sides` parameter — the spline then propagates it sample-to-sample
 * with a parallel-transport-style smoother to guarantee orientation
 * continuity across the entire ribbon.
 */

const COLLINEAR_TOL = 1e-6;

function normalize(out: Float64Array, i: number): boolean {
  const x = out[i];
  const y = out[i + 1];
  const z = out[i + 2];
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len < COLLINEAR_TOL) return false;
  const inv = 1 / len;
  out[i] = x * inv;
  out[i + 1] = y * inv;
  out[i + 2] = z * inv;
  return true;
}

function cross(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  out: Float64Array,
  i: number,
): void {
  out[i] = ay * bz - az * by;
  out[i + 1] = az * bx - ax * bz;
  out[i + 2] = ax * by - ay * bx;
}

/**
 * Pick any unit vector perpendicular to the (already-unit) tangent
 * `(tx, ty, tz)`. Used as the last-resort fallback when Carson-Bugg
 * fails *and* there is no neighbour to copy from (e.g. a chain of two
 * residues, or a fully collinear chain). Selects the world axis least
 * aligned with the tangent so the cross product never collapses.
 */
function arbitraryPerpendicular(
  tx: number,
  ty: number,
  tz: number,
  out: Float64Array,
  i: number,
): void {
  const ax = Math.abs(tx);
  const ay = Math.abs(ty);
  const az = Math.abs(tz);
  let rx = 0;
  let ry = 0;
  let rz = 0;
  if (ax <= ay && ax <= az) rx = 1;
  else if (ay <= az) ry = 1;
  else rz = 1;
  out[i] = ry * tz - rz * ty;
  out[i + 1] = rz * tx - rx * tz;
  out[i + 2] = rx * ty - ry * tx;
  normalize(out, i);
}

/**
 * Build a per-residue side-vector field from a Cα chain.
 *
 * @param caPositions  - Flat `[x0, y0, z0, x1, y1, z1, …]` of Cα
 *                       coordinates in N→C order. One chain only —
 *                       caller is responsible for splitting at chain
 *                       breaks before calling.
 * @returns A `Float64Array` of length `3 * n` carrying unit side
 *          vectors, ready to feed to the spline as the `sides`
 *          argument.
 */
export function computeSideVectors(caPositions: Float64Array): Float64Array {
  const n = caPositions.length / 3;
  const sides = new Float64Array(n * 3);
  if (n < 2) return sides;

  const tangents = new Float64Array(n * 3);
  for (let i = 0; i < n - 1; i++) {
    const k = i * 3;
    tangents[k] = caPositions[k + 3] - caPositions[k];
    tangents[k + 1] = caPositions[k + 4] - caPositions[k + 1];
    tangents[k + 2] = caPositions[k + 5] - caPositions[k + 2];
  }
  // Last tangent copies the previous one — for a chain of n residues
  // there are only n−1 well-defined backbone segments.
  const last = (n - 1) * 3;
  tangents[last] = tangents[last - 3];
  tangents[last + 1] = tangents[last - 2];
  tangents[last + 2] = tangents[last - 1];

  // Pass 1: raw Carson-Bugg side at every interior residue. Boundary
  // residues are filled in pass 2.
  const valid = new Uint8Array(n);
  for (let i = 1; i < n - 1; i++) {
    const k = i * 3;
    const ax = tangents[k - 3];
    const ay = tangents[k - 2];
    const az = tangents[k - 1];
    const bx = tangents[k];
    const by = tangents[k + 1];
    const bz = tangents[k + 2];
    cross(ax, ay, az, bx, by, bz, sides, k);
    if (normalize(sides, k)) valid[i] = 1;
  }

  // Pass 2: forward-fill boundaries and collinear degeneracies from
  // the nearest valid interior residue, then back-fill anything still
  // empty. This walks each gap O(n) once.
  let firstValid = -1;
  for (let i = 0; i < n; i++) {
    if (valid[i]) {
      firstValid = i;
      break;
    }
  }
  if (firstValid < 0) {
    // No interior curvature anywhere — synthesize a perpendicular to
    // the (constant) tangent direction and copy to every residue.
    const tk = 0;
    const tlen = Math.sqrt(
      tangents[tk] * tangents[tk] +
        tangents[tk + 1] * tangents[tk + 1] +
        tangents[tk + 2] * tangents[tk + 2],
    );
    const tx = tlen > 0 ? tangents[tk] / tlen : 1;
    const ty = tlen > 0 ? tangents[tk + 1] / tlen : 0;
    const tz = tlen > 0 ? tangents[tk + 2] / tlen : 0;
    arbitraryPerpendicular(tx, ty, tz, sides, 0);
    for (let i = 1; i < n; i++) {
      const k = i * 3;
      sides[k] = sides[0];
      sides[k + 1] = sides[1];
      sides[k + 2] = sides[2];
    }
    return sides;
  }
  // Forward fill before the first valid residue.
  for (let i = 0; i < firstValid; i++) {
    const k = i * 3;
    const f = firstValid * 3;
    sides[k] = sides[f];
    sides[k + 1] = sides[f + 1];
    sides[k + 2] = sides[f + 2];
  }
  // Forward fill after the first valid residue, copying the previous
  // residue's side whenever the current is invalid. Apply the
  // sign-continuity rule in the same pass so the result is C¹ along
  // the chain.
  let prev = firstValid * 3;
  for (let i = firstValid + 1; i < n; i++) {
    const k = i * 3;
    if (!valid[i]) {
      sides[k] = sides[prev];
      sides[k + 1] = sides[prev + 1];
      sides[k + 2] = sides[prev + 2];
    } else {
      const dot =
        sides[k] * sides[prev] +
        sides[k + 1] * sides[prev + 1] +
        sides[k + 2] * sides[prev + 2];
      if (dot < 0) {
        sides[k] = -sides[k];
        sides[k + 1] = -sides[k + 1];
        sides[k + 2] = -sides[k + 2];
      }
    }
    prev = k;
  }

  return sides;
}
