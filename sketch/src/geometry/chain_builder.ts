import { DEFAULT_BOND_LENGTH, snapDirection } from "./snap";

export interface ChainGeometry {
  /** Canonical points after the start; does not include the start. */
  points: Array<{ x: number; y: number }>;
}

/**
 * Build carbon chain points from start toward end with fixed bond length.
 * Returns only intermediate+end points (not start) as new atoms.
 */
export function buildChainPoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  step: number = DEFAULT_BOND_LENGTH,
): ChainGeometry {
  const dx = endX - startX;
  const dy = endY - startY;
  const dist = Math.hypot(dx, dy);
  const segmentCount = Math.round(dist / step);
  if (segmentCount < 2) {
    return { points: [] };
  }
  const { ux, uy } = snapDirection(dx, dy);
  const cos30 = Math.sqrt(3) / 2;
  const points: Array<{ x: number; y: number }> = [];
  let x = startX;
  let y = startY;
  for (let segment = 0; segment < segmentCount; segment++) {
    const sin30 = segment % 2 === 0 ? 0.5 : -0.5;
    x += step * (ux * cos30 - uy * sin30);
    y += step * (uy * cos30 + ux * sin30);
    points.push({ x, y });
  }
  return { points };
}
