import type { Frame } from "@molcrafts/molvis-core/molrs";
import { viewAtomCoords } from "../io/atom_coords";

/**
 * Soft budget for LinkedCell pair materialization on the auto path.
 * Keep in sync with the hard refuse in streaming RDF if re-introduced.
 */
export const RDF_MAX_ESTIMATED_PAIRS = 25_000_000;

/** Periodic auto r_max factor — GROMACS/LAMMPS-style fraction of min box length. */
const PERIODIC_RMAX_FRACTION = 0.45;
/** Absolute upper bound on the *auto* rMax default (Å). */
const AUTO_RMAX_HARD_CAP = 50;
/** Never auto-suggest below this (still useful for sparse systems). */
const AUTO_RMAX_FLOOR = 2.5;

/**
 * Estimate a practical default rMax for pair-distribution / neighbor search.
 *
 * - **Periodic:** `0.45 × min(Lx, Ly, Lz)` (slightly under L/2 for safety),
 *   then clamped to the pair-count budget for huge dense boxes.
 * - **Non-periodic:** maximum observed pair distance (sampled), so isolated
 *   molecules get ~molecular diameter automatically.
 *
 * @returns Estimated rMax in the frame's length unit, or 0 if unusable.
 */
export function estimateRMax(frame: Frame): number {
  const atoms = frame.getBlock("atoms");
  const n = atoms?.nrows() ?? 0;

  const box = frame.box;
  if (box) {
    const lengths = box.lengths();
    const L = lengths.toCopy();
    lengths.free();
    // Do NOT free box — freeing a box/getBlock handle corrupts the frame's
    // shared data on subsequent reads (see memory: project_molrs_handle_ownership).
    const minL = Math.min(L[0], L[1], L[2]);
    if (!(minL > 0) || !Number.isFinite(minL)) return 0;
    const halfMin = minL / 2;
    const preferred = PERIODIC_RMAX_FRACTION * minL;
    const capped = Math.min(preferred, AUTO_RMAX_HARD_CAP);
    return clampRMaxToPairBudget(
      Math.max(AUTO_RMAX_FLOOR, capped),
      n,
      box.volume(),
      halfMin,
    );
  }

  if (!atoms || n < 2) return 0;

  const coords = viewAtomCoords(atoms);
  const x = coords?.x;
  const y = coords?.y;
  const z = coords?.z;
  if (!x || !y || !z) return 0;

  // Sample up to ~100×100 pairs for a cheap max-distance estimate.
  const step = Math.max(1, Math.floor(n / 100));
  let maxR2 = 0;
  for (let i = 0; i < n; i += step) {
    for (let j = i + 1; j < n; j += step) {
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const dz = z[j] - z[i];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > maxR2) maxR2 = r2;
    }
  }
  const maxPair = Math.sqrt(maxR2);
  if (!(maxPair > 0)) return 0;
  // Slight pad so the outermost pairs land inside the last bin.
  const padded = maxPair * 1.05;
  return Math.min(Math.max(padded, AUTO_RMAX_FLOOR), AUTO_RMAX_HARD_CAP);
}

/** Shrink r until estimated self-pairs fit the LinkedCell budget (or floor). */
function clampRMaxToPairBudget(
  rMax: number,
  nParticles: number,
  volume: number,
  halfMin: number,
): number {
  let r = rMax;
  if (!(nParticles > 0) || !(volume > 0) || !Number.isFinite(volume)) {
    return r;
  }
  const floor = Math.min(
    AUTO_RMAX_FLOOR,
    halfMin > 0 ? halfMin : AUTO_RMAX_FLOOR,
  );
  let guard = 0;
  while (
    r > floor &&
    estimateSelfPairCount(nParticles, volume, r) > RDF_MAX_ESTIMATED_PAIRS &&
    guard < 40
  ) {
    r *= 0.9;
    guard += 1;
  }
  return Math.max(r, floor);
}

/**
 * Rough expected self-pair count for a dense system: N × (4/3 π r³ ρ) / 2.
 * Used to refuse cutoffs that would blow the WASM neighbor list.
 */
export function estimateSelfPairCount(
  nParticles: number,
  volume: number,
  rMax: number,
): number {
  if (
    !(nParticles > 0) ||
    !(volume > 0) ||
    !(rMax > 0) ||
    !Number.isFinite(nParticles + volume + rMax)
  ) {
    return 0;
  }
  const rho = nParticles / volume;
  const neighbors = (4 / 3) * Math.PI * rMax * rMax * rMax * rho;
  return (nParticles * neighbors) / 2;
}
