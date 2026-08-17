/**
 * Fence (lasso) selection utilities.
 * Pure geometry functions for point-in-polygon testing.
 */

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Test if a point is inside a polygon using the ray-casting algorithm.
 * Returns true if the point is inside the polygon.
 *
 * The polygon is defined by an array of vertices (automatically closed).
 * Works for both convex and concave polygons.
 */
export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = polygon[i].y;
    const yj = polygon[j].y;
    const xi = polygon[i].x;
    const xj = polygon[j].x;

    if (yi > point.y !== yj > point.y) {
      const intersectX = xj + ((point.y - yj) / (yi - yj)) * (xi - xj);
      if (point.x < intersectX) {
        inside = !inside;
      }
    }
  }

  return inside;
}

/**
 * Simplify a polyline by removing points that are within `tolerance`
 * distance of the previous kept point. Reduces point count for
 * smoother polygon testing and overlay rendering.
 */
export function simplifyPolyline(
  points: Point2D[],
  tolerance: number,
): Point2D[] {
  if (points.length <= 2) return [...points];

  const result: Point2D[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const last = result[result.length - 1];
    const dx = points[i].x - last.x;
    const dy = points[i].y - last.y;
    if (dx * dx + dy * dy >= tolerance * tolerance) {
      result.push(points[i]);
    }
  }

  // Always include the last point
  const lastInput = points[points.length - 1];
  const lastKept = result[result.length - 1];
  if (lastInput !== lastKept) {
    result.push(lastInput);
  }

  return result;
}
