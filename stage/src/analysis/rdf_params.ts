import type { Frame } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";

/**
 * How the radial pair histogram is presented.
 *
 * - `auto` — g(r) when the frame has a box; pair distribution otherwise
 * - `gr` — classic RDF g(r); needs a reference volume (box or explicit)
 * - `pair` — raw pair counts p(r); never needs volume
 * - `density` — shell-normalized pair density ρ(r) = n(r) / (4π r² dr)
 */
export type PairRepresentation = "auto" | "gr" | "pair" | "density";

/** Resolved representation after applying Auto + frame geometry. */
export type ResolvedPairRepresentation = "gr" | "pair" | "density";

/**
 * Where the reference volume for g(r) comes from when the frame has no box.
 * Periodic frames always use the simulation box (readonly).
 */
export type ReferenceVolumeSource = "box" | "manual" | "bbox" | "sphere";

export interface RdfParams {
  /**
   * Maximum distance cutoff. Omit or leave undefined for Auto
   * ({@link estimateRMax}): periodic ≈ 0.45 × min box length; non-periodic
   * ≈ maximum sampled pair distance.
   */
  rMax?: number;
  /**
   * Lower radial cutoff. Defaults to 0 (freud convention). Pairs with
   * `d < rMin` and pairs at exactly `d == 0` are excluded.
   */
  rMin?: number;
  /**
   * Number of bins (default 100). Use {@link estimateNBins} at the call site
   * for Auto ≈ `rMax / 0.02` (panel leaves this empty and resolves it).
   */
  nBins?: number;
  /** Indices of atoms to include (default: all atoms). When only groupA is set, self-histogram. */
  groupA?: number[];
  /** Indices for cross-histogram second group. If omitted, uses groupA. */
  groupB?: number[];
  /**
   * Normalization volume in Å³. Required only for g(r) on non-periodic
   * frames (no box). For periodic frames, overrides the box volume if set.
   * Ignored for `pair` / `density` representations.
   */
  volume?: number;
  /**
   * Presentation mode. Defaults to `auto`.
   */
  representation?: PairRepresentation;
}

export interface RdfResult {
  /** Bin center distances */
  r: Float64Array;
  /**
   * Primary y-series for the resolved representation
   * (g(r), pair counts, or shell density).
   */
  y: Float64Array;
  /** Axis / series label for {@link y}. */
  yLabel: string;
  /** Resolved representation actually computed. */
  representation: ResolvedPairRepresentation;
  /** g(r) values when volume was available; otherwise zeros. */
  gr: Float64Array;
  /** Raw pair counts per bin */
  counts: Float64Array;
  /** Shell density ρ(r) = n(r)/(4π r² dr) */
  density: Float64Array;
  /** Number of bins */
  nBins: number;
  /** Bin width */
  dr: number;
  /** Upper cutoff used */
  rMax: number;
  /** Lower cutoff used */
  rMin: number;
  /** Number of reference particles used */
  nParticles: number;
  /**
   * Normalization volume used for g(r) (Å³). `NaN` when g(r) was not
   * computed (pair / density without a real reference volume).
   */
  volume: number;
  /** True when a real reference volume was used (box or explicit). */
  hasReferenceVolume: boolean;
}

const DEFAULT_N_BINS = 100;
/** Target bin width (Å) when auto-choosing nBins. */
const AUTO_BIN_WIDTH = 0.02;
const AUTO_BINS_MIN = 10;
const AUTO_BINS_MAX = 500;

export function frameHasBox(frame: Frame): boolean {
  return frame.box != null;
}

/**
 * Resolve Auto → concrete representation from frame geometry.
 */
export function resolvePairRepresentation(
  frame: Frame,
  representation: PairRepresentation = "auto",
): ResolvedPairRepresentation {
  if (representation === "auto") {
    return frameHasBox(frame) ? "gr" : "pair";
  }
  return representation;
}

export function representationYLabel(rep: ResolvedPairRepresentation): string {
  switch (rep) {
    case "gr":
      return "g(r)";
    case "pair":
      return "p(r)";
    case "density":
      return "ρ(r)";
  }
}

/**
 * Auto bin count so bin width stays near 0.01–0.05 Å.
 */
export function estimateNBins(rMax: number, rMin = 0): number {
  const span = rMax - rMin;
  if (!(span > 0) || !Number.isFinite(span)) return DEFAULT_N_BINS;
  const n = Math.round(span / AUTO_BIN_WIDTH);
  return Math.max(AUTO_BINS_MIN, Math.min(AUTO_BINS_MAX, n));
}

/**
 * Axis-aligned bounding-box volume of atom coordinates (Å³), or null.
 */
export function estimateBoundingBoxVolume(frame: Frame): number | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms || atoms.nrows() < 1) return null;
  const coords = viewAtomCoords(atoms);
  if (!coords) return null;
  const { x, y, z } = coords;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = y[i];
    const zi = z[i];
    if (xi < minX) minX = xi;
    if (yi < minY) minY = yi;
    if (zi < minZ) minZ = zi;
    if (xi > maxX) maxX = xi;
    if (yi > maxY) maxY = yi;
    if (zi > maxZ) maxZ = zi;
  }
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  // Degenerate (planar / collinear) → null so callers fall back to manual.
  if (!(dx > 0 && dy > 0 && dz > 0)) return null;
  return dx * dy * dz;
}

/**
 * Bounding-sphere volume (sphere through farthest atom from centroid), or null.
 */
export function estimateBoundingSphereVolume(frame: Frame): number | null {
  const atoms = frame.getBlock("atoms");
  if (!atoms || atoms.nrows() < 1) return null;
  const coords = viewAtomCoords(atoms);
  if (!coords) return null;
  const { x, y, z } = coords;
  const n = x.length;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += x[i];
    cy += y[i];
    cz += z[i];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let maxR2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - cx;
    const dy = y[i] - cy;
    const dz = z[i] - cz;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > maxR2) maxR2 = r2;
  }
  if (!(maxR2 > 0)) return null;
  const r = Math.sqrt(maxR2);
  return (4 / 3) * Math.PI * r * r * r;
}
