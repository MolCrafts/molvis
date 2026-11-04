/** Plain 2D geometry shared by the depiction layout and its refiner. */

export interface Point {
  x: number;
  y: number;
}

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function unit(v: Point, fallback: Point): Point {
  const length = Math.hypot(v.x, v.y);
  if (length < 1e-9) return fallback;
  return { x: v.x / length, y: v.y / length };
}

export function centroid(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  if (span < 1e-12) return distance(p, a);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / span),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** `p` mirrored across the line through `a` and `b`. */
export function reflect(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  if (span < 1e-12) return { x: p.x, y: p.y };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / span;
  return { x: 2 * (a.x + t * dx) - p.x, y: 2 * (a.y + t * dy) - p.y };
}

export function rotate(p: Point, about: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * cos - dy * sin, y: about.y + dx * sin + dy * cos };
}

/**
 * `count` points on a circular arc from `a` to `b` with every step one bond
 * long, bulging to the left of a → b (`side` 1) or to the right (`side` -1). A shared edge (|ab| = one bond) gives a
 * regular polygon; a longer shared path gives the arc that closes the ring.
 */
export function arcBetween(
  a: Point,
  b: Point,
  count: number,
  length: number,
  side: 1 | -1,
): Point[] {
  const segments = count + 1;
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d >= segments * length * 0.999 || d < 1e-9) {
    return Array.from({ length: count }, (_, k) => ({
      x: a.x + ((b.x - a.x) * (k + 1)) / segments,
      y: a.y + ((b.y - a.y) * (k + 1)) / segments,
    }));
  }
  // Chord of `segments` equal steps of central angle theta:
  // d = L sin(segments θ / 2) / sin(θ / 2), decreasing on (0, 2π/segments).
  let lo = 1e-9;
  let hi = (2 * Math.PI) / segments - 1e-9;
  for (let step = 0; step < 80; step++) {
    const mid = (lo + hi) / 2;
    const chord = (length * Math.sin((segments * mid) / 2)) / Math.sin(mid / 2);
    if (chord > d) lo = mid;
    else hi = mid;
  }
  const theta = (lo + hi) / 2;
  const radius = length / (2 * Math.sin(theta / 2));
  const span = segments * theta;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const along = { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
  const normal = { x: -along.y * side, y: along.x * side };
  const offset = -radius * Math.cos(span / 2);
  const center = {
    x: mid.x + normal.x * offset,
    y: mid.y + normal.y * offset,
  };
  const startAngle = Math.atan2(a.y - center.y, a.x - center.x);
  const endAngle = Math.atan2(b.y - center.y, b.x - center.x);
  const wrap = (t: number) => Math.abs(Math.atan2(Math.sin(t), Math.cos(t)));
  const direction =
    wrap(startAngle + span - endAngle) <= wrap(startAngle - span - endAngle)
      ? 1
      : -1;
  return Array.from({ length: count }, (_, k) => {
    const angle = startAngle + direction * theta * (k + 1);
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

/** Rotate so the principal axis is horizontal; isotropic shapes stay put. */
export function alignLongAxis(points: readonly Point[]): Point[] {
  const c = centroid(points);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const spread = sxx + syy;
  if (spread < 1e-9 || Math.hypot(sxx - syy, 2 * sxy) < 0.05 * spread) {
    return points.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  return points.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  });
}
