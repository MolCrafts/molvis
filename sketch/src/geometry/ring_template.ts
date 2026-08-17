import { DEFAULT_BOND_LENGTH } from "./snap";

export type RingKind = "aliphatic" | "benzene";

export interface RingGeometry {
  kind: RingKind;
  /** Document-space vertices. */
  vertices: Array<{ x: number; y: number }>;
  /** Edges as vertex index pairs. */
  edges: Array<[number, number]>;
  /** Circumradius used (document units). */
  radius: number;
  /** Edge length (= bond length for regular polygon). */
  bondLength: number;
}

/**
 * Regular n-gon ring — **same geometry as RDKit / OpenBabel 2D**:
 * side length = bondLength, circumradius
 *   R = bondLength / (2 · sin(π/n))
 *
 * For benzene (n=6), R = bondLength (regular hexagon).
 * Do not invent ad-hoc radii; always derive from bond length.
 *
 * @see RDKit `Depictor` / OpenBabel `OBPainter` regular-polygon placement
 */
export function buildRingTemplate(
  size: number,
  cx: number,
  cy: number,
  bondLength: number = DEFAULT_BOND_LENGTH,
  kind: RingKind = "aliphatic",
  rotationRad = -Math.PI / 2,
  clockwise = false,
): RingGeometry {
  if (size < 3 || size > 8) {
    throw new Error(`ring size must be 3..8, got ${size}`);
  }
  const bl =
    bondLength > 0 && Number.isFinite(bondLength)
      ? bondLength
      : DEFAULT_BOND_LENGTH;
  // Regular n-gon with side = bl (RDKit/OpenBabel convention)
  const radius = bl / (2 * Math.sin(Math.PI / size));

  // Flat-top hexagon is more ChemDraw-like for benzene (pointy-top is ok too;
  // ChemDraw default benzene is often pointy-top with first double on the right).
  // Use pointy-top (vertex at top) — matches common Kekulé textbook drawings.
  const vertices: Array<{ x: number; y: number }> = [];
  const direction = clockwise ? -1 : 1;
  for (let i = 0; i < size; i++) {
    const ang = rotationRad + (direction * (i * 2 * Math.PI)) / size;
    vertices.push({
      x: cx + radius * Math.cos(ang),
      y: cy + radius * Math.sin(ang),
    });
  }
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < size; i++) {
    edges.push([i, (i + 1) % size]);
  }
  return { kind, vertices, edges, radius, bondLength: bl };
}
